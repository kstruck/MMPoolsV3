import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { BillingGate } from '../billing';
import { Calendar, Lock, Settings, Share2, FileText, Mail, Phone, Trophy, Target, Timer, Flame } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { PoolPicksReveal } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { User, Pool, NFLGame, WeeklyRecap } from '../../types';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { formatSharpScore, recapHasHighlights, weeklyWinnerLabel } from '../../utils/recapHighlight';
import { CountdownTo } from '../common/CountdownTo';

// Lazy load or import sub-views (we will create them next!)
import { PickemPickEntry } from './PickemPickEntry';
import { SurvivorPickEntry } from './SurvivorPickEntry';
import { MarginPickEntry } from './MarginPickEntry';
import { NFLStandings } from './NFLStandings';
import { NFLPoolRules } from './NFLPoolRules';
import { NFLManagerView } from './NFLManagerView';
import { PickDistribution } from './PickDistribution';
import { NFLUserBentoDashboard } from './NFLUserBentoDashboard';
import { AICommissioner } from '../AICommissioner';
import { useToast } from '../ui/Toast';
import { Button } from '../ui';
import { now as serverNow } from '../../utils/serverClock';
import { gamesForPoolWeek, poolSeasonType, currentSlateWeek, poolSeasonWeeks } from '../../utils/nflPending';
import { buildMemberStandings } from '../../utils/memberStandings';
import { usesWeeklyHardLock, normalizeLockBufferMinutes, resolveHardWeekLock, frozenHardLockFor } from '@shared/weeklyHardLock';
import { WeekChecklist } from './WeekChecklist';
import { PaymentsPanel } from '../PaymentsPanel';
// New imports go at the END of this block — #420 and #421 both appended here and
// conflicted when they didn't (measured).
import { NFLResults } from './NFLResults';
import { NFLPicksGrid } from './NFLPicksGrid';
import { NFLWeeklyPicksGrid } from './NFLWeeklyPicksGrid';

interface NFLPoolDashboardProps {
  pool: Pool;
  user: User | null;
  isManager: boolean;
  onBack: () => void;
  onOpenAuth: () => void;
}

export const NFLPoolDashboard: React.FC<NFLPoolDashboardProps> = ({
  pool,
  user,
  isManager,
  onBack,
  onOpenAuth
}) => {
  const castPool = pool as any;
  const seasonType = poolSeasonType(castPool);
  const toast = useToast();

  // Tab lives in the URL so the browser Back button steps through tabs (and refresh
  // restores the view) instead of leaving the pool. Tab changes push a history entry.
  const [searchParams, setSearchParams] = useSearchParams();
  // `results` sits next to `standings`: Standings answers "who is winning the
  // season", Results answers "what happened in a week / across the weeks".
  // Survivor has no per-week score to tabulate, so the tab is hidden for it
  // (see the strip below) — but the value stays VALID for every pool type on
  // purpose: a stale `?tab=results` link into a Survivor pool must fall back to
  // the dashboard rather than crash, and dropping it from this list is what
  // makes that fallback happen.
  type TabType = 'dashboard' | 'picks' | 'grid' | 'standings' | 'results' | 'recaps' | 'rules' | 'payments' | 'manager';
  const VALID_TABS: TabType[] = ['dashboard', 'picks', 'grid', 'standings', 'results', 'recaps', 'rules', 'payments', 'manager'];
  const showResultsTab = pool.type !== 'NFL_SURVIVOR';
  // CURRENT PICKS (Kevin's A2, widened by PLAN-MEMBER-PICKS-VISIBILITY).
  //
  // 🛑 THE `isManager` HALF IS GONE, AND THAT IS THE POINT OF THIS CHANGE.
  // It was an authorization fact, not a layout preference: `getPoolPicks` used
  // to refuse anyone who was not the owner, manager or SUPER_ADMIN, so a member
  // opening this tab got a grid of "?" and nothing else. The callable now admits
  // a proven member (`assertPickReader`), so the tab is offered to everyone
  // signed in — and a NON-member still gets a refusal from the server and a grid
  // of "?", which is the honest answer rather than a crash.
  //
  // ⚠️ ALL THREE NFL TYPES. An earlier draft said "drop isManager, keep the
  // pool-type gate", which removes the wrong half and leaves Margin and Survivor
  // with no tab at all — the exact contradiction codex found in the plan. The
  // pool TYPE now selects the COMPONENT, not whether the tab exists.
  const showPicksGridTab = !!user && ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].includes(pool.type);
  const tabParam = searchParams.get('tab') as TabType | null;
  const requestedTab: TabType = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'dashboard';
  // A tab the pool does not offer falls back to the dashboard, exactly as an
  // unknown one does. Without this a Survivor pool opened on a shared
  // `?tab=results` link renders an EMPTY content area: the strip has no Results
  // button to un-press and no other branch matches, so the member sees a pool
  // page with nothing in it and no way to tell what went wrong. (Own diff read.)
  //
  // Same fallback for `?tab=grid`, and it has one more way to be reached: a
  // commissioner sharing their own URL. The link works for them and must not
  // hand every member a blank page.
  const tabOffered: Record<TabType, boolean> = {
    dashboard: true, picks: true, standings: true, recaps: true, rules: true, manager: isManager,
    payments: !!user, results: showResultsTab, grid: showPicksGridTab,
  };
  const activeTab: TabType = tabOffered[requestedTab] ? requestedTab : 'dashboard';
  const setActiveTab = (tab: TabType) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('tab', tab);
      return p;
    });
  };

  // Declared before the week defaulting below, which reads `games` — a `const`
  // is not hoisted, so leaving it with the other subscribed state would be a TDZ
  // crash on first render.
  const [games, setGames] = useState<NFLGame[]>([]);

  // Estimate current NFL Week based on date (standard season calculations).
  // serverNow(), not Date.now(): a skewed device clock must not choose the week
  // (qodo #4). Only reachable before the schedule loads — the slate decides after.
  const getEstimatedNFLWeek = (): number => {
    const now = serverNow();
    const isPre = seasonType === 1;

    if (isPre) {
      const preseasonStart = new Date('2026-08-06T00:00:00').getTime(); // HOF Weekend kickoff
      if (now < preseasonStart) return 1;
      const diffMs = now - preseasonStart;
      const weekNum = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
      return Math.min(4, Math.max(1, weekNum));
    } else {
      const seasonStart = new Date('2026-09-10T00:00:00').getTime(); // Estimated kickoff of Week 1
      if (now < seasonStart) return 1;
      const diffMs = now - seasonStart;
      const weekNum = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
      return Math.min(18, Math.max(1, weekNum));
    }
  };

  // The loaded slate decides the default week; the date estimate is only the
  // fallback for before games arrive (see currentSlateWeek for why). Deps are
  // (games, seasonType) rather than the pool: both this and getEstimatedNFLWeek
  // read the pool for nothing but its season type.
  const currentEstWeek = useMemo(
    () => currentSlateWeek(games, castPool) ?? getEstimatedNFLWeek(),
    [games, seasonType],
  );
  // Selected week also rides in the URL (?week=) so refresh/Back restore the drilldown.
  // Week changes replace (not push) so scrubbing weeks doesn't spam browser history.
  const weekParam = searchParams.get('week');
  const parsedWeek = weekParam ? Number(weekParam) : NaN;
  const selectedWeek: number = Number.isFinite(parsedWeek) && parsedWeek >= 1 && parsedWeek <= 18 ? parsedWeek : currentEstWeek;
  const setSelectedWeek = (week: number) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('week', String(week));
      return p;
    }, { replace: true });
  };

  // Subscribed States
  const [members, setMembers] = useState<any[]>([]);
  const [recaps, setRecaps] = useState<WeeklyRecap[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Subscribe to NFL Games
  useEffect(() => {
    setIsLoading(true);
    const unsub = dbService.subscribeToNFLGames(castPool.season, (data) => {
      setGames(data);
      setIsLoading(false);
    });
    return () => unsub();
  }, [castPool.season]);

  // 2. Entry data — ONE path for every viewer (PLAN-COMMISSIONER-BLIND-PICKS T4).
  //
  // The manager/owner branch used to subscribe to the raw `entries` collection,
  // which is how a commissioner saw everyone's picks before kickoff. Rules no
  // longer serve it to them (T3), so both roles now read the same three sources:
  // the reveal-safe standings projection, the Member Records, and their OWN entry
  // document.
  //
  // ⚠️ `subscribeToMyNFLEntry` is now load-bearing for the commissioner, not just
  // the member. A commissioner is usually also a player, and their own entry is
  // what the three pick-entry forms render and edit — dropping the raw read
  // without this would make their own saved picks vanish while `getPoolPicks`
  // correctly refused to hand them back before the boundary.
  const [standingsRows, setStandingsRows] = useState<any[]>([]);
  const [ownEntry, setOwnEntry] = useState<any | null>(null);
  // Stamped with the pool it came from, and keyed BY WEEK.
  //
  // `PoolRoute` reuses this component across pool navigation, so a response
  // outlives the pool that asked for it — see the `weekReveal` note below for
  // why the week check alone is not enough.
  //
  // 🛑 THE WEEK KEY IS NOT A CACHE OPTIMISATION, IT IS THE ALLOWLIST BOUNDARY.
  // The Survivor/Margin grid draws many weeks at once, and those pool types key
  // a pick by the WEEK NUMBER — so `weekRevealed`, not `revealedGameIds`, is
  // what admits a cell. One shared response across columns would render week 2's
  // pick using week 1's `weekRevealed`, leaking a week that has not locked.
  // Each week therefore keeps its OWN WHOLE response. (Plan D6/T9, codex r2.)
  const [reveal, setReveal] = useState<{ poolId: string; byWeek: Record<number, PoolPicksReveal> }>(
    { poolId: pool.id, byWeek: {} },
  );

  useEffect(() => {
    const unsubStandings = dbService.subscribeToNFLStandings(pool.id, setStandingsRows);
    const unsubOwn = user
      ? dbService.subscribeToMyNFLEntry(pool.id, user.id, setOwnEntry)
      : undefined;
    return () => { unsubStandings(); unsubOwn?.(); };
  }, [pool.id, user?.id]);

  // 2a. The commissioner's pick window. `getPoolPicks` is a callable, not a
  // subscription — a reveal boundary passing is a CLOCK event with no Firestore
  // write behind it, so nothing would push. Refetched when the week changes, when
  // a Member Record moves (every submit writes one), and on a slow poll so a
  // kickoff opens the window without a page reload.
  // Which weeks the grid needs. The selected week always; for Survivor and
  // Margin — whose grid is players × WEEKS — every week of the pool's own slate
  // up to and including it. Never a hardcoded 18: a preseason pool has four, and
  // the schedule is the only thing that knows (plan K7).
  const gridWeeks = useMemo(() => {
    if (pool.type === 'NFL_PICKEM') return [selectedWeek];
    return poolSeasonWeeks(games, pool).filter(w => w <= selectedWeek);
  }, [games, pool, selectedWeek]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = (weeks: number[]) => {
      for (const w of weeks) {
        dbService.getPoolPicks(pool.id, w)
          .then(r => {
            if (cancelled) return;
            // Merge into the pool's own bucket; a response for another pool is
            // discarded rather than merged, which is the #430 guard generalised.
            setReveal(prev => prev.poolId === pool.id
              ? { poolId: pool.id, byWeek: { ...prev.byWeek, [w]: r } }
              : { poolId: pool.id, byWeek: { [w]: r } });
          })
          // A refusal is not a crash — a non-member gets one, and the surfaces
          // simply keep rendering Hidden / "?" which is the honest answer.
          .catch(err => { logger.warn('[NFLPoolDashboard] getPoolPicks failed', err); });
      }
    };
    load(gridWeeks);
    // ⚠️ ONLY THE SELECTED WEEK IS RE-POLLED. A past week's reveal cannot
    // change — it is a clock boundary that has already passed — so re-fetching
    // the whole column set every minute would multiply the call volume by the
    // season length for no new information.
    //
    // Members poll five times slower than the commissioner: after this change
    // EVERY member of every pool polls this callable, where before only the
    // commissioner did, and a commissioner is the only one who needs
    // minute-fresh completeness to chase missing picks.
    const id = setInterval(() => load([selectedWeek]), isManager ? 60_000 : 300_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, pool.id, pool.type, selectedWeek, members, user?.id, gridWeeks.join(',')]);

  // ⚠️ ONLY EVER USE THE REVEAL THAT MATCHES THE POOL AND THE WEEK ON SCREEN.
  // `reveal` holds the previous answer for the moment between changing either
  // one and the callable returning, and that answer is wrong in a way that
  // shows: the counts would drive "4 of 16 Picks Set" and the roster's
  // picked/unpicked state for a week nobody is looking at. Dropping it for that
  // moment renders the honest fallback instead. (Own diff read.)
  //
  // 🛑 THE POOL CHECK IS NOT BELT-AND-BRACES ON THE WEEK CHECK — it catches a
  // case the week check cannot. NFL game ids are GLOBAL (`espn_…`), so two
  // pools on the same week share a slate: navigating between two pools this
  // commissioner runs leaves the previous pool's response matching by week,
  // and `buildMemberStandings` grafts its picks onto any uid in both rosters.
  // Pick CONTENT from a pool that is no longer on screen. Clearing the state in
  // the effect instead would blank the grid on every `members` snapshot, which
  // is every submit — hence a stamp rather than a reset. (codex r1.)
  const revealsForPool = reveal.poolId === pool.id ? reveal.byWeek : {};
  const weekReveal = revealsForPool[selectedWeek]?.week === selectedWeek
    ? revealsForPool[selectedWeek]
    : null;

  // Roster from Member Records, stats from the scored projection, own picks from
  // the own-entry doc, other members' picks only where the SERVER revealed them.
  // The projection alone is a snapshot of the last SCORED week, so a member who
  // joined after it was written was invisible to everyone but the commissioner —
  // see buildMemberStandings for the full reasoning.
  //
  // 🛑 DERIVED DURING RENDER, NOT SET FROM AN EFFECT (codex r6). It used to be
  // `useState` + `useEffect`, which made it lag `weekReveal` by exactly one
  // paint — and the two are read TOGETHER by the picks grid: the fresh reveal
  // supplies the allowlist while the stale `entries` still carry no picks. On
  // the render where a game first reveals, every player who picked it was drawn
  // as "—", i.e. "made no pick", and corrected a frame later. Same class as the
  // three stale-state defects above, and a memo removes it outright rather than
  // sequencing around it. The deps are unchanged.
  //
  // Depends on `participantIds`, not the whole pool object: it is the only field
  // buildMemberStandings reads from the pool, and a snapshot re-instantiating the
  // doc should not re-run this. (qodo.)
  const entries = useMemo(
    () => buildMemberStandings({
      pool: castPool, members, standingsRows, ownEntry, reveal: weekReveal,
      // Survivor and Margin draw many weeks at once, so their rows need every
      // cached week's revealed picks — not just the selected week's, which
      // would render every earlier column as "made no pick". The per-column
      // reveal gate still lives in the cell. (codex P1.)
      weeklyReveals: pool.type === 'NFL_PICKEM' ? undefined : Object.values(revealsForPool),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [standingsRows, ownEntry, members, weekReveal, castPool.participantIds, pool.type, revealsForPool],
  );

  // 2b. Subscribe to Member Records (roster truth — everyone who joined, ADR 0003)
  useEffect(() => {
    const unsub = dbService.subscribeToPoolMembers(pool.id, (data) => {
      setMembers(data);
    });
    return () => unsub();
  }, [pool.id]);

  // 3. Subscribe to Weekly Recaps
  useEffect(() => {
    const unsub = dbService.subscribeToWeeklyRecaps(pool.id, (data) => {
      setRecaps(data);
    });
    return () => unsub();
  }, [pool.id]);

  // Filter games for the currently selected week and seasonType
  const weeklyGames = useMemo(() => {
    const filtered = gamesForPoolWeek(games, castPool, selectedWeek);
    console.log("[NFLPoolDashboard] weeklyGames filter ran:", {
      selectedWeek,
      poolSeasonTypeRaw: castPool.seasonType, // undefined here means regular season, not "missing"
      poolSeasonType: seasonType,
      totalGamesCount: games.length,
      filteredGamesCount: filtered.length,
      filteredGames: filtered.map(g => ({ id: g.id, week: g.week, seasonType: g.seasonType }))
    });
    return filtered;
  }, [games, selectedWeek, castPool, seasonType]);

  // Retrieve user's personal entry. The own-entry DOCUMENT wins: it is the only
  // object that carries this viewer's full pick map, and after T4 the synthesized
  // `entries` row for them is a scored projection with picks grafted on. The
  // lookup stays as a fallback for the moment before the snapshot lands.
  const myEntry = useMemo(() => {
    if (!user) return null;
    return ownEntry || entries.find(e => e.ownerUid === user.id) || null;
  }, [ownEntry, entries, user]);

  // Check if the current selected week is locked (earliest game kicked off).
  // Server-corrected clock — device time can drift and lie about the deadline.
  // Ticks so the lock state re-evaluates while a pick page is left open through the
  // deadline — otherwise the memo below keeps a stale `false`, the form stays live,
  // and the member's submit is rejected by the server with no warning.
  const [lockTick, setLockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLockTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Returns the deadline too, not just a boolean: several views render a "locks
  // at" time, and showing the first kickoff there would tell a Survivor/Margin
  // member they can pick up to 60 minutes later than the server allows.
  const weekLock = useMemo(() => {
    void lockTick;
    if (weeklyGames.length === 0) return { deadline: null as number | null, locked: false };
    // Survivor/Margin run a hard weekly deadline and the server snaps their buffer
    // to an allowed preset — normalize here too, or the UI would disagree with the
    // server on a legacy value (a stored 0 would show picks open past the deadline
    // the server actually enforces).
    const bufferMinutes = usesWeeklyHardLock(castPool.type)
      ? normalizeLockBufferMinutes(castPool.settings?.lockBufferMinutes)
      : (castPool.settings?.lockBufferMinutes ?? 5);
    const bufferMs = bufferMinutes * 60 * 1000;
    const earliestKickoff = Math.min(...weeklyGames.map(g => g.startTime));
    const computed = earliestKickoff - bufferMs;
    // The server enforces the earliest deadline it ever froze for this week, so a
    // widened buffer must not make the UI show the week open for the gap.
    const deadline = usesWeeklyHardLock(castPool.type)
      ? resolveHardWeekLock(frozenHardLockFor(castPool, selectedWeek), computed)
      : computed;
    return { deadline, locked: serverNow() >= deadline };
  }, [weeklyGames, castPool.settings?.lockBufferMinutes, castPool.type, castPool.hardLockByWeek, selectedWeek, lockTick]);
  const isWeekLocked = weekLock.locked;

  // Time remaining to earliest game this week
  const earliestGame = useMemo(() => {
    if (weeklyGames.length === 0) return null;
    return weeklyGames.reduce((prev, curr) => prev.startTime < curr.startTime ? prev : curr);
  }, [weeklyGames]);

  // Season opener — the first kickoff of the whole season. Rules edits lock here.
  const seasonOpenTime = useMemo(() => {
    const seasonGames = games.filter(g => Number(g.seasonType) === seasonType);
    if (seasonGames.length === 0) return null;
    return Math.min(...seasonGames.map(g => g.startTime));
  }, [games, seasonType]);

  // Share handler
  const handleShare = () => {
    const url = `${window.location.origin}/join/${pool.id}`;
    navigator.clipboard.writeText(url);
    toast.success('Invite link copied to clipboard!');
  };

  const branding = castPool.branding || {};
  const accentHex = branding.secondaryColor || '#C9A867';

  return (
    <BillingGate pool={pool as any} isCommissioner={isManager}>
    <div
      className="min-h-screen bg-page text-[color:var(--text)] font-body pb-20 relative transition-colors duration-500"
      style={{ backgroundColor: branding.bgColor || undefined }}
    >
      {/* Pool Header Bar */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 border border-line rounded-xl shadow-card">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {branding.logoUrl && (
                <img src={branding.logoUrl} className="h-12 w-auto object-contain drop-shadow" alt="Logo" />
              )}
              <h1 className="font-display font-extrabold uppercase text-3xl text-[color:var(--text)] leading-none">{pool.name}</h1>
            </div>
            <p className="text-muted font-body text-sm font-semibold mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 flex-wrap">
                Host: <strong className="text-[color:var(--text)] font-bold">{pool.managerName || 'Host'}</strong>
                {castPool.contactMethod !== 'none' && (
                  <span className="flex items-center gap-1.5 ml-1 inline-flex">
                    {(castPool.contactMethod === 'email' || castPool.contactMethod === 'both' || !castPool.contactMethod) && pool.contactEmail && (
                      <a
                        href={`mailto:${pool.contactEmail}`}
                        className="p-1 bg-navy-800/5 hover:bg-navy-800/10 text-navy-700 dark:bg-gold-400/10 dark:hover:bg-gold-400/20 dark:text-gold-400 border border-line rounded-sm transition-all duration-150 hover:scale-105 flex items-center justify-center cursor-pointer"
                        title={`Email Host: ${pool.contactEmail}`}
                      >
                        <Mail size={12} />
                      </a>
                    )}
                    {(castPool.contactMethod === 'phone' || castPool.contactMethod === 'both') && castPool.contactPhone && (
                      <a
                        href={`tel:${castPool.contactPhone}`}
                        className="p-1 bg-navy-800/5 hover:bg-navy-800/10 text-navy-700 dark:bg-gold-400/10 dark:hover:bg-gold-400/20 dark:text-gold-400 border border-line rounded-sm transition-all duration-150 hover:scale-105 flex items-center justify-center cursor-pointer"
                        title={`Call/SMS Host: ${castPool.contactPhone}`}
                      >
                        <Phone size={12} />
                      </a>
                    )}
                  </span>
                )}
              </span>
              <span className="text-faint">•</span>
              <span className="text-navy-700 dark:text-gold-400 uppercase font-display font-bold text-[12px] tracking-[0.08em]">
                {pool.type === 'NFL_PICKEM' ? 'Weekly Pick\'em' :
                 pool.type === 'NFL_SURVIVOR' ? 'Survivor Pool' : 'Margin Pool'}
              </span>
            </p>
          </div>

          <div className="flex gap-2.5 items-center flex-wrap">
            {/* Week Selector */}
            <div className="flex items-center gap-2 bg-page border-[1.5px] border-line rounded-md px-3 py-1.5">
              <Calendar size={16} className="text-muted" />
              <select
                value={selectedWeek}
                onChange={e => setSelectedWeek(parseInt(e.target.value))}
                className="bg-transparent focus:outline-none font-body text-sm text-[color:var(--text)] font-bold cursor-pointer"
              >
                {Array.from({ length: seasonType === 1 ? 4 : 18 }, (_, i) => i + 1).map(w => (
                  <option key={w} value={w} className="bg-card text-[color:var(--text)]">
                    {nflWeekLabel(seasonType, w)}
                  </option>
                ))}
              </select>
            </div>

            <Button variant="ghost" size="sm" onClick={handleShare}>
              <Share2 size={13} /> Invite Link
            </Button>

            {isManager && (
              <Button variant="secondary" size="sm" onClick={() => setActiveTab('manager')}>
                <Settings size={13} /> Commissioner
              </Button>
            )}
          </div>
        </div>

        {/* Week-by-week pending/done strip + "picks due" call-to-action */}
        {!isLoading && (
          <div className="mt-6">
            <WeekChecklist
              pool={pool}
              entry={myEntry}
              games={games}
              selectedWeek={selectedWeek}
              onSelectWeek={setSelectedWeek}
              onPickNow={(week) => { setSelectedWeek(week); setActiveTab('picks'); }}
            />
          </div>
        )}

        {/* Global tab routing headers */}
        <div className="flex border-b border-line mt-8 mb-6 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'dashboard'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'dashboard' ? { borderBottomColor: accentHex } : {}}
          >
            Pool Home
          </button>
          <button
            onClick={() => setActiveTab('picks')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'picks'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'picks' ? { borderBottomColor: accentHex } : {}}
          >
            My Entry
          </button>
          {showPicksGridTab && (
            <button
              onClick={() => setActiveTab('grid')}
              className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
                activeTab === 'grid'
                  ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                  : 'text-muted hover:text-[color:var(--text)] border-transparent'
              }`}
              style={activeTab === 'grid' ? { borderBottomColor: accentHex } : {}}
            >
              Current Picks
            </button>
          )}
          <button
            onClick={() => setActiveTab('standings')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'standings'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'standings' ? { borderBottomColor: accentHex } : {}}
          >
            Standings & Leaderboard
          </button>
          {showResultsTab && (
            <button
              onClick={() => setActiveTab('results')}
              className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
                activeTab === 'results'
                  ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                  : 'text-muted hover:text-[color:var(--text)] border-transparent'
              }`}
              style={activeTab === 'results' ? { borderBottomColor: accentHex } : {}}
            >
              Results
            </button>
          )}
          <button
            onClick={() => setActiveTab('recaps')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'recaps'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'recaps' ? { borderBottomColor: accentHex } : {}}
          >
            Weekly Recaps
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'rules'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'rules' ? { borderBottomColor: accentHex } : {}}
          >
            Rules & Rulesets
          </button>
          {user && (
            <button
              onClick={() => setActiveTab('payments')}
              className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
                activeTab === 'payments'
                  ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                  : 'text-muted hover:text-[color:var(--text)] border-transparent'
              }`}
              style={activeTab === 'payments' ? { borderBottomColor: accentHex } : {}}
            >
              Payments
            </button>
          )}
        </div>

        {/* Tab View Routers */}
        <div className="space-y-6">
          {isLoading ? (
            <div className="text-center py-16">
              <div className="animate-spin w-10 h-10 border-4 border-gold-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-muted font-body font-bold">Synchronizing game feeds...</p>
            </div>
          ) : (
            <>
              {/* TAB 0: BENTO DASHBOARD OVERVIEW */}
              {activeTab === 'dashboard' && (
                <>
                  <NFLUserBentoDashboard
                    pool={pool}
                    user={user}
                    games={games}
                    entries={entries}
                    recaps={recaps}
                    selectedWeek={selectedWeek}
                    setSelectedWeek={setSelectedWeek}
                    isWeekLocked={isWeekLocked}
                    earliestGame={earliestGame}
                    weekLockAt={weekLock.deadline}
                    onBack={onBack}
                    onOpenAuth={onOpenAuth}
                    isManager={isManager}
                    onSelectTab={(tab) => setActiveTab(tab)}
                  />
                  {castPool.billing?.featuresUnlocked?.aiCommissioner && (
                    <div className="max-w-4xl mx-auto mt-6">
                      <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                    </div>
                  )}
                </>
              )}

              {/* TAB 1: PICK ENTRY */}
              {activeTab === 'picks' && (
                <>
                  {!user ? (
                    <div className="bg-card border border-line rounded-xl shadow-card p-8 text-center max-w-md mx-auto my-12">
                      <Lock size={40} className="text-faint mx-auto mb-3" />
                      <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Member Authentication Required</h3>
                      <p className="font-body text-muted text-sm mb-6">
                        You must sign in or register to submit or review pick sheets in this pool.
                      </p>
                      <Button onClick={onOpenAuth}>
                        Sign In / Register
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      {/* Left/Center columns: Matchups/Picks list */}
                      <div className="lg:col-span-2 space-y-6">
                        {pool.type === 'NFL_PICKEM' && (
                          <PickemPickEntry
                            pool={pool}
                            user={user}
                            week={selectedWeek}
                            games={weeklyGames}
                            seasonGames={games}
                            entry={myEntry}
                            isWeekLocked={isWeekLocked}
                          />
                        )}

                        {pool.type === 'NFL_SURVIVOR' && (
                          <SurvivorPickEntry
                            pool={pool}
                            user={user}
                            week={selectedWeek}
                            games={weeklyGames}
                            seasonGames={games}
                            entry={myEntry}
                            isWeekLocked={isWeekLocked}
                          />
                        )}

                        {pool.type === 'NFL_MARGIN' && (
                          <MarginPickEntry
                            pool={pool}
                            user={user}
                            week={selectedWeek}
                            games={weeklyGames}
                            seasonGames={games}
                            entry={myEntry}
                            isWeekLocked={isWeekLocked}
                          />
                        )}
                      </div>

                      {/* Right column: Quick overview/stats */}
                      <div className="space-y-6">
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                          <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-4">
                            {nflWeekLabel(seasonType, selectedWeek)} Lock Status
                          </h3>

                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              {isWeekLocked ? (
                                <div className="p-2.5 bg-cream rounded-md text-muted border border-line">
                                  <Lock size={18} />
                                </div>
                              ) : (
                                <div className="p-2.5 bg-[#E5EDF6] rounded-md text-[#142A4C] border border-[#CBDCEC] animate-pulse">
                                  <Calendar size={18} />
                                </div>
                              )}
                              <div>
                                <h4 className="font-display font-bold uppercase text-sm text-[color:var(--text)]">
                                  {isWeekLocked ? 'Selections Locked' : 'Picks are Open'}
                                </h4>
                                <p className="font-body text-[11px] text-muted">
                                  {isWeekLocked
                                    ? 'Host is syncing game outcomes.'
                                    : 'Make changes before kickoff.'}
                                </p>
                              </div>
                            </div>

                            {weekLock.deadline !== null && !isWeekLocked && (
                              <div className="bg-page p-3 rounded-lg text-center border border-line">
                                <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted block mb-1">
                                  Locks in
                                </span>
                                <span className="text-gold-600 dark:text-gold-400 num font-bold text-sm">
                                  {new Date(weekLock.deadline).toLocaleString()}
                                </span>
                                <CountdownTo deadline={weekLock.deadline} onExpire={() => setLockTick(t => t + 1)} />
                              </div>
                            )}
                          </div>
                        </div>

                        <PickDistribution
                          pool={pool}
                          games={weeklyGames}
                          week={selectedWeek}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* TAB 1b: CURRENT PICKS — players × this week's games. `activeTab`
                  is already normalized above, so this can only be true on a
                  Pick'em pool with a commissioner viewing it. */}
              {activeTab === 'grid' && (
                pool.type === 'NFL_PICKEM' ? (
                  <NFLPicksGrid
                    pool={pool}
                    entries={entries}
                    games={games}
                    week={selectedWeek}
                    viewerUid={user?.id}
                    reveal={weekReveal}
                    ownEntryLoaded={!!ownEntry}
                  />
                ) : (
                  /* Survivor and Margin: one pick per WEEK, so the axis is weeks
                     rather than the week's slate. Each column is handed the whole
                     per-week reveal map and picks out ITS OWN — see the
                     component header for why that is a security property. */
                  <NFLWeeklyPicksGrid
                    pool={pool}
                    entries={entries}
                    games={games}
                    week={selectedWeek}
                    viewerUid={user?.id}
                    revealsByWeek={revealsForPool}
                    ownEntryLoaded={!!ownEntry}
                  />
                )
              )}

              {/* TAB 2: STANDINGS */}
              {activeTab === 'standings' && (
                <NFLStandings
                  pool={pool}
                  entries={entries}
                  games={games}
                  week={selectedWeek}
                  viewerUid={user?.id}
                  pickCounts={weekReveal?.counts}
                />
              )}

              {/* TAB 2b: RESULTS — weekly + season tables over the SAME scored
                  projection the standings render. `activeTab` is already
                  normalized above, so this can only be true on a pool that
                  offers the tab. */}
              {activeTab === 'results' && (
                <NFLResults
                  pool={pool}
                  entries={entries}
                  games={games}
                  week={selectedWeek}
                  viewerUid={user?.id}
                />
              )}

              {/* TAB 3: RECAPS */}
              {activeTab === 'recaps' && (
                <div className="max-w-xl mx-auto space-y-6">
                  {castPool.billing?.featuresUnlocked?.aiCommissioner && (
                    <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                  )}
                  {recaps.length === 0 ? (
                    <div className="bg-card border border-line rounded-xl p-8 text-center shadow-card">
                      <FileText size={40} className="text-faint mx-auto mb-3" />
                      <h4 className="font-display font-bold uppercase text-sm text-[color:var(--text)]">No Weekly Recaps Available</h4>
                      <p className="font-body text-[13px] text-muted mt-1">
                        Recaps will compile automatically after commissioner scores active weeks.
                      </p>
                    </div>
                  ) : (
                    recaps.map(recap => (
                      <div key={recap.id} className="bg-card border border-line rounded-xl p-6 shadow-card space-y-4">
                        <div className="flex justify-between items-center border-b border-line pb-3">
                          <h4 className="font-display font-bold uppercase text-lg text-[color:var(--text)] flex items-center gap-2">
                            <Trophy size={18} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> {nflWeekLabel(seasonType, recap.week)} Recap Summary
                          </h4>
                          <span className="text-[11px] text-muted font-bold num">
                            {new Date(recap.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="space-y-3.5 font-body text-sm">
                          {/* A recap document only exists after a COMPLETE scoring pass, so by
                              the time this card renders the week is already over. The copy must
                              NOT promise live updates — an empty recap means there was nothing to
                              rank (nobody submitted, or no game produced a result), not that more
                              is on the way. */}
                          {!recapHasHighlights(recap) && (
                            <p className="text-muted text-[13px]">
                              No highlights this week — there were no results to rank.
                            </p>
                          )}

                          {/* WHO WON THE WEEK. Written only on a COMPLETE
                              scoring pass — every game concluded and past its
                              own lock — so it cannot appear as a mid-Sunday
                              "leader so far" that members would read as a
                              result (PLAN-WEEKLY-TIEBREAKERS §8b).

                              More than one name is a SHARED win: the pool's
                              tiebreaker could not separate them, or there was
                              no tiebreaker to apply. That is the ordinary
                              outcome of a tie, not an error state. */}
                          {!!recap.weeklyWinners?.length && (
                            <div className="flex justify-between items-center border-b border-line pb-2 gap-3">
                              <span className="text-muted font-bold flex items-center gap-1.5 shrink-0"><Trophy size={13} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> {weeklyWinnerLabel((pool as { settings?: { payoutMode?: string } }).settings?.payoutMode, recap.weeklyWinners.length > 1)}:</span>
                              <span className="text-[color:var(--text)] font-display font-bold num text-right">
                                {recap.weeklyWinners.map(w => w.userName).join(', ')}
                                {' '}({formatSharpScore(pool.type, recap.weeklyWinners[0].points)}{recap.weeklyWinners.length > 1 ? ' each' : ''})
                              </span>
                            </div>
                          )}

                          {/* Suppressed when the winner line is present: both
                              are "highest score this week", so rendering both
                              prints the same name twice — and on a TIED week
                              they would disagree, because `sharpOfWeek` still
                              holds the arbitrary first-iterated entry that
                              `weeklyWinners` exists to replace. It is still
                              WRITTEN, so older recaps keep rendering. */}
                          {!recap.weeklyWinners?.length && recap.sharpOfWeek && (
                            <div className="flex justify-between items-center border-b border-line pb-2">
                              <span className="text-muted font-bold flex items-center gap-1.5"><Target size={13} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Sharp of the Week:</span>
                              <span className="text-[color:var(--text)] font-display font-bold num">
                                {recap.sharpOfWeek.userName} ({formatSharpScore(pool.type, recap.sharpOfWeek.score)})
                              </span>
                            </div>
                          )}

                          {recap.closestTiebreaker && (
                            <div className="flex justify-between items-center border-b border-line pb-2">
                              <span className="text-muted font-bold flex items-center gap-1.5"><Timer size={13} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Closest Tiebreaker:</span>
                              <span className="text-[color:var(--text)] font-display font-bold num">
                                {recap.closestTiebreaker.userName} (diff: {recap.closestTiebreaker.diff})
                              </span>
                            </div>
                          )}

                          {recap.attritionCount !== undefined && (
                            <div className="flex justify-between items-center">
                              <span className="text-muted font-bold flex items-center gap-1.5"><Flame size={13} className="text-brandred-600" aria-hidden="true" /> Survivor Attrition Remaining:</span>
                              <span className="text-brandred-600 font-display font-bold num">
                                {recap.attritionCount} Players Alive
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 4: RULES */}
              {activeTab === 'rules' && (
                <NFLPoolRules
                  pool={pool}
                  isManager={isManager}
                  onEditRules={() => setActiveTab('manager')}
                  lockTime={seasonOpenTime}
                />
              )}

              {/* TAB 5: PAYMENTS — member money view (status, pot, ledger) */}
              {activeTab === 'payments' && user && (
                <PaymentsPanel pool={pool} user={user} entries={entries} members={members} isManager={isManager} onManagePayments={() => setActiveTab('manager')} />
              )}

              {/* TAB 5: COMMISSIONER */}
              {activeTab === 'manager' && isManager && (
                <NFLManagerView
                  pool={pool}
                  entries={entries}
                  members={members}
                  games={games}
                  week={selectedWeek}
                  user={user}
                  pickCounts={weekReveal?.counts}
                  onSelectTab={(tab) => setActiveTab(tab)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </BillingGate>
  );
};
