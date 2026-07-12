// Deterministic NFL scenario generator (PLAN-NFL-SIM-HARNESS Phase 1.12).
// Pure TS, no firebase imports — lives in shared/ so the browser Test Suite and
// the functions emulator runner materialize IDENTICAL fixtures from one spec.
// Own PRNG (mulberry32), never Math.random: same seed ⇒ byte-identical output.

export interface NFLGeneratorSpec {
  seed: number;
  weeks: number;            // 1..18
  entryCount: number;       // simulated Members
  gamesPerWeek?: number;    // default 4 (bounded: emulator speed × 18 weeks)
  seasonType?: number;      // default 2 (regular season)
  /** Pick strategy per entry index (cycled): favorites follow the spread,
   *  random is PRNG-uniform, contrarian fades the spread. */
  strategies?: Array<'favorites' | 'random' | 'contrarian'>;
}

export interface GeneratedGame {
  week: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  isMonday?: boolean;
  spread: number;           // relative to home; negative = home favored
  status: 'FINAL';
}

export interface GeneratedEntry {
  userName: string;
  // Pick'em: week -> per-week game key ("g1"...) -> team abbreviation
  pickemPicks: Record<string, Record<string, string>>;
  confidence?: Record<string, Record<string, number>>;
  weeklyTiebreakers: Record<string, number>;
  // Survivor / Margin: week -> team abbreviation
  survivorPicks: Record<string, string>;
  marginPicks: Record<string, string>;
}

export interface GeneratedSeason {
  games: GeneratedGame[];
  entries: GeneratedEntry[];
}

/** mulberry32 — tiny, seedable, good-enough distribution for fixtures. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 16 teams is plenty for fixtures; two disjoint 8-team rotations per week keep
// matchups valid (a team never plays twice in one week).
const TEAMS = ['KC', 'BUF', 'SF', 'DAL', 'BAL', 'DET', 'PHI', 'MIA', 'GB', 'NYJ', 'CIN', 'LAR', 'MIN', 'SEA', 'PIT', 'HOU'];

/** Deterministic full-season fixture. Same spec ⇒ deep-equal result, always. */
export function generateNFLSeason(spec: NFLGeneratorSpec): GeneratedSeason {
  const rnd = mulberry32(spec.seed);
  const gamesPerWeek = Math.min(spec.gamesPerWeek ?? 4, Math.floor(TEAMS.length / 2));
  const strategies = spec.strategies?.length ? spec.strategies : ['favorites', 'random', 'contrarian'];

  const games: GeneratedGame[] = [];
  for (let week = 1; week <= spec.weeks; week++) {
    // Rotate the team list per week so matchups vary but stay collision-free.
    const rotated = [...TEAMS.slice(week % TEAMS.length), ...TEAMS.slice(0, week % TEAMS.length)];
    for (let g = 0; g < gamesPerWeek; g++) {
      const home = rotated[g * 2];
      const away = rotated[g * 2 + 1];
      // Spread in [-10, +10] half-point steps; scores correlated with it so
      // favorites win ~70% — enough upsets to exercise every code path.
      const spread = Math.round((rnd() * 40 - 20)) / 2;
      const base = 17 + Math.floor(rnd() * 14);
      const margin = Math.floor(rnd() * 21) - 7 - spread; // negative spread (home fav) biases home
      const homeScore = Math.max(0, base + Math.ceil(margin / 2));
      const awayScore = Math.max(0, base - Math.floor(margin / 2));
      games.push({
        week, home, away, homeScore, awayScore, spread,
        isMonday: g === gamesPerWeek - 1, // last game each week is MNF
        status: 'FINAL',
      });
    }
  }

  const entries: GeneratedEntry[] = [];
  for (let i = 0; i < spec.entryCount; i++) {
    const strategy = strategies[i % strategies.length];
    const entry: GeneratedEntry = {
      userName: `Gen${String(i + 1).padStart(2, '0')}-${strategy}`,
      pickemPicks: {}, weeklyTiebreakers: {}, survivorPicks: {}, marginPicks: {},
    };
    const survivorUsed = new Set<string>();
    const marginUsed = new Set<string>();
    for (let week = 1; week <= spec.weeks; week++) {
      const weekGames = games.filter(g => g.week === week);
      const weekPicks: Record<string, string> = {};
      weekGames.forEach((g, idx) => {
        const favorite = g.spread <= 0 ? g.home : g.away;
        const dog = g.spread <= 0 ? g.away : g.home;
        const pick = strategy === 'favorites' ? favorite
          : strategy === 'contrarian' ? dog
          : (rnd() < 0.5 ? g.home : g.away);
        weekPicks[`g${idx + 1}`] = pick;
      });
      entry.pickemPicks[String(week)] = weekPicks;
      // Confidence: a unique 1..N assignment per week (the engine validates
      // uniqueness). favorites/contrarian weight by |spread|; random shuffles.
      const conf: Record<string, number> = {};
      const order = weekGames
        .map((g, idx) => ({ key: `g${idx + 1}`, mag: Math.abs(g.spread), r: rnd() }))
        .sort((a, b) => strategy === 'random' ? a.r - b.r : b.mag - a.mag);
      order.forEach((o, rank) => { conf[o.key] = weekGames.length - rank; });
      entry.confidence = { ...(entry.confidence ?? {}), [String(week)]: conf };
      const mnf = weekGames[weekGames.length - 1];
      entry.weeklyTiebreakers[String(week)] = mnf ? 30 + Math.floor(rnd() * 25) : 40;

      // Survivor: strongest unused favorite this week (per strategy bias).
      const candidates = weekGames
        .map(g => (g.spread <= 0 ? { team: g.home, s: g.spread } : { team: g.away, s: -g.spread }))
        .sort((a, b) => a.s - b.s)
        .map(c => c.team)
        .filter(t => !survivorUsed.has(t));
      const survivorPick = strategy === 'contrarian'
        ? candidates[candidates.length - 1] ?? candidates[0]
        : candidates[0];
      if (survivorPick) {
        entry.survivorPicks[String(week)] = survivorPick;
        survivorUsed.add(survivorPick);
      }
      // Margin ALSO enforces used-teams (submitNFLPicks margin branch tracks
      // usedTeams like survivor) — generated picks must be valid on the REAL
      // submission path, not just for direct writes.
      const marginCandidates = weekGames
        .map(g => (g.spread <= 0 ? { team: g.home, s: g.spread } : { team: g.away, s: -g.spread }))
        .sort((a, b) => a.s - b.s)
        .map(c => c.team)
        .filter(t => !marginUsed.has(t));
      const marginPick = strategy === 'contrarian'
        ? marginCandidates[marginCandidates.length - 1] ?? marginCandidates[0]
        : marginCandidates[0];
      if (marginPick) {
        entry.marginPicks[String(week)] = marginPick;
        marginUsed.add(marginPick);
      }
    }
    entries.push(entry);
  }

  return { games, entries };
}
