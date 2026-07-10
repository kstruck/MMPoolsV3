// Scenario Oracle (PLAN-NFL-SIM-HARNESS Phase 1.13, CONTEXT.md "Scenario Oracle").
// Computes EXPECTED outcomes from a fixture alone. Deliberately independent:
// it must NEVER import the scoring engine — oracle/engine disagreement is a
// finding to investigate, not a value to sync.
//
// Rule sources are the product rules as documented (PLAN-TEST-SUITE item 13/14,
// ADR 0005 graded-outcome vocabulary), re-implemented here from scratch:
//   Pick'em STRAIGHT: 1 point per correctly-picked game winner; a tied game
//     grades PUSH (no point, not a loss). Confidence mode: the point value is
//     the entry's assigned confidence for that game.
//   Pick'em ATS: pick covers the spread => W (1 pt / confidence), exactly on
//     the spread => PUSH (0), else L. CANCELLED games grade VOID (0, excluded
//     from totals).
//   Survivor (sudden-death defaults): a week's pick must WIN or the entry takes
//     a strike; strikes > maxStrikes => ELIMINATED at that week. Ties survive
//     (no loss). pickLosersMode inverts the win condition.
//   Margin: weekly score = picked team's signed victory margin; season total
//     accumulates. Tie game = 0.
// Edge semantics beyond these (auto-survive exemptions, rebuys, dual-MNF) are
// added alongside the Phase 4 edge scenarios, each human-verified before use.

import type { GeneratedSeason, GeneratedGame } from './simGen';

export interface OraclePickemEntryExpectation {
  userName: string;
  weeklyPoints: Record<string, number>;
  totalScore: number;
  gradedPicks: Record<string, Record<string, 'W' | 'L' | 'PUSH' | 'VOID'>>; // week -> gameKey -> grade
}

export interface OracleSurvivorEntryExpectation {
  userName: string;
  status: 'ALIVE' | 'ELIMINATED';
  strikesUsed: number;
  eliminatedWeek: number | null;
}

export interface OracleMarginEntryExpectation {
  userName: string;
  weeklyScores: Record<string, number>;
  seasonTotal: number;
}

const winnerOf = (g: GeneratedGame): string | null =>
  g.homeScore === g.awayScore ? null : (g.homeScore > g.awayScore ? g.home : g.away);

/** ATS grade for a pick, home-relative spread (negative = home favored). */
function atsGrade(g: GeneratedGame, pick: string): 'W' | 'L' | 'PUSH' {
  const adjHome = g.homeScore + g.spread; // home covers if adjHome > away
  if (adjHome === g.awayScore) return 'PUSH';
  const coverer = adjHome > g.awayScore ? g.home : g.away;
  return pick === coverer ? 'W' : 'L';
}

export function expectPickem(
  season: GeneratedSeason,
  opts: { pickMode?: 'STRAIGHT' | 'ATS'; confidenceMode?: boolean } = {},
): OraclePickemEntryExpectation[] {
  const mode = opts.pickMode ?? 'STRAIGHT';
  return season.entries.map(e => {
    const weeklyPoints: Record<string, number> = {};
    const gradedPicks: OraclePickemEntryExpectation['gradedPicks'] = {};
    for (const [week, picks] of Object.entries(e.pickemPicks)) {
      const weekGames = season.games.filter(g => g.week === Number(week));
      let pts = 0;
      const grades: Record<string, 'W' | 'L' | 'PUSH' | 'VOID'> = {};
      weekGames.forEach((g, idx) => {
        const key = `g${idx + 1}`;
        const pick = picks[key];
        if (!pick) return;
        if ((g as { status?: string }).status === 'CANCELLED') { grades[key] = 'VOID'; return; }
        let grade: 'W' | 'L' | 'PUSH';
        if (mode === 'ATS') {
          grade = atsGrade(g, pick);
        } else {
          const w = winnerOf(g);
          grade = w === null ? 'PUSH' : (pick === w ? 'W' : 'L');
        }
        grades[key] = grade;
        if (grade === 'W') {
          pts += opts.confidenceMode ? Number(e.confidence?.[week]?.[key] ?? 0) : 1;
        }
      });
      weeklyPoints[week] = pts;
      gradedPicks[week] = grades;
    }
    const totalScore = Object.values(weeklyPoints).reduce((s, p) => s + p, 0);
    return { userName: e.userName, weeklyPoints, totalScore, gradedPicks };
  });
}

export function expectSurvivor(
  season: GeneratedSeason,
  opts: { maxStrikes?: number; pickLosersMode?: boolean } = {},
): OracleSurvivorEntryExpectation[] {
  const maxStrikes = opts.maxStrikes ?? 0;
  return season.entries.map(e => {
    let strikes = 0;
    let eliminatedWeek: number | null = null;
    const weeks = Object.keys(e.survivorPicks).map(Number).sort((a, b) => a - b);
    for (const week of weeks) {
      if (eliminatedWeek !== null) break;
      const pick = e.survivorPicks[String(week)];
      const game = season.games.find(g => g.week === week && (g.home === pick || g.away === pick));
      if (!game) continue; // pick not playing — the ENGINE rejects this pre-write; oracle skips
      const w = winnerOf(game);
      if (w === null) continue; // tie: survive
      const survived = opts.pickLosersMode ? w !== pick : w === pick;
      if (!survived) {
        strikes++;
        if (strikes > maxStrikes) eliminatedWeek = week;
      }
    }
    return {
      userName: e.userName,
      status: eliminatedWeek === null ? 'ALIVE' : 'ELIMINATED',
      strikesUsed: strikes,
      eliminatedWeek,
    };
  });
}

export function expectMargin(season: GeneratedSeason): OracleMarginEntryExpectation[] {
  return season.entries.map(e => {
    const weeklyScores: Record<string, number> = {};
    for (const [week, pick] of Object.entries(e.marginPicks)) {
      const game = season.games.find(g => g.week === Number(week) && (g.home === pick || g.away === pick));
      if (!game) continue;
      const margin = game.home === pick
        ? game.homeScore - game.awayScore
        : game.awayScore - game.homeScore;
      weeklyScores[week] = margin;
    }
    const seasonTotal = Object.values(weeklyScores).reduce((s, m) => s + m, 0);
    return { userName: e.userName, weeklyScores, seasonTotal };
  });
}
