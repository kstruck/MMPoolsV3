import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { BillingGate } from '../billing';
import { isPoolManager, isSuperAdmin } from '../../utils/auth';
import { Calendar, Lock, Settings, Share2, FileText, Mail, Phone, Trophy, Target, Timer, Flame, ArrowLeft, Users, Crown } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { PoolPicksReveal } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { User, Pool, NFLGame, WeeklyRecap, BanterMessage } from '../../types';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { formatSharpScore, recapHasHighlights, weeklyWinnerLabel } from '../../utils/recapHighlight';
import { WeeklyWinnersList } from './WeeklyWinnersList';
import { CountdownTo } from '../common/CountdownTo';

// Lazy load or import sub-views (we will create them next!)
import { PickemPickEntry } from './PickemPickEntry';
import { SurvivorPickEntry } from './SurvivorPickEntry';
import { MarginPickEntry } from './MarginPickEntry';
import { EntrySwitcher, type EntryDraft } from './EntrySwitcher';
import { sortOwnEntries, nextAddableEntryIndex } from '../../utils/entrySelection';
import { effectiveMaxEntriesPerUser, defaultEntryName } from '@shared/multiEntry';
import { NFLStandingsTab } from './NFLStandingsTab';
import { NFLPoolRules } from './NFLPoolRules';
import { NFLManagerView } from './NFLManagerView';
import { PickDistribution } from './PickDistribution';
import { NFLUserBentoDashboard } from './NFLUserBentoDashboard';
import { AICommissioner } from '../AICommissioner';
import { useToast } from '../ui/Toast';
import { Button } from '../ui';
import { now as serverNow } from '../../utils/serverClock';
import { gamesForPoolWeek, poolSeasonType, currentSlateWeek, poolSeasonWeeks } from '../../utils/nflPending';
import { picksAvailability } from '../../utils/picksAvailability';
import { buildMemberStandings } from '../../utils/memberStandings';
import { brandingStyles } from '../../utils/brandingStyles';
import { nflLockMode, weekLockAtFor, nextLockAtFor } from '@shared/nflLockMode';
import { WeekChecklist } from './WeekChecklist';
import { PaymentsPanel } from '../PaymentsPanel';
// New imports go at the END of this block — #420 and #421 both appended here and
// conflicted when they didn't (measured).
import { NFLPicksGrid } from './NFLPicksGrid';
import { NFLWeeklyPicksGrid } from './NFLWeeklyPicksGrid';
import { HelpRoutePublisher } from '../../help/publish';
import { resolveStandingsAlias, type StandingsScope } from '../../utils/nflStandingsScope';
import { isPinnableMessageId } from '@shared/pinnedMessage';
import { poolTypeLabel, poolOptionLabels } from '../../utils/poolTypeLabel';
import { weekValueFor, seasonCompare } from '../../utils/nflResults';
import { NFL_KICKOFF_MS } from '../../config/season';

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
  // 🛑 T10: `results` IS NO LONGER A TAB. It is a URL ALIAS for the Standings
  // tab's "This Week" segment (Kevin, 2026-08-23: one Standings tab on every
  // NFL pool type, the shape Survivor already had). It stays VALID here for two
  // separate reasons:
  //   1. a shared `?tab=results` link, a Help link or browser history from
  //      before the merge must LAND on the week view rather than fall to the
  //      dashboard — `resolveStandingsAlias` does that mapping; and
  //   2. on a SURVIVOR pool there is no week view to land on, and dropping the
  //      value from this list is exactly what makes it fall back to the
  //      dashboard rather than render an empty content area.
  // `tabOffered.results` below is still what separates those two cases.
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
  const resolvedTab: TabType = tabOffered[requestedTab] ? requestedTab : 'dashboard';
  // THE one member-facing nav (2026-08-23 mobile redesign). Rendered from data
  // so the strip stays a single system — the bento's duplicate sidebar menu is
  // gone. `manager` is deliberately absent: the Commissioner button in the
  // header card is its only door. Filtered through `tabOffered`, same authority
  // that routes a `?tab=` URL.
  const TAB_STRIP: { tab: TabType; label: string }[] = [
    { tab: 'dashboard', label: 'Pool Home' },
    // Right of Pool Home (Kevin, 2026-08-23): "arguably the most important
    // tab", and the whole mobile redesign started from people hunting for it.
    { tab: 'standings', label: 'Standings & Results' },
    { tab: 'picks', label: 'My Entry' },
    { tab: 'grid', label: 'Current Picks' },
    { tab: 'recaps', label: 'Weekly Recaps' },
    { tab: 'rules', label: 'Rules & Rulesets' },
    { tab: 'payments', label: 'Payments' },
  ];
  // T10: `results` collapses into `standings` HERE, once, so the strip, the tab
  // router and Help all see one tab. Everything downstream reads `activeTab`.
  const { tab: activeTab, scope: standingsScope } =
    resolveStandingsAlias(resolvedTab) as { tab: TabType; scope: StandingsScope };
  // `section` = which commissioner sub-tab the manager view opens on (only
  // `?tab=manager&section=members` is used today — the member Payments tab's
  // "Open Payment Ledger"). Cleared on every other tab change so a later click
  // on the Manager tab lands on Overview, not on the last deep-link.
  const setActiveTab = (tab: TabType, section?: string) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('tab', tab);
      if (section) p.set('section', section); else p.delete('section');
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
      // Week 1's boundary — the same kickoff instant every other surface uses
      // (src/config/season.ts). Was a fifth hardcoded copy, and a whole day out.
      const seasonStart = NFL_KICKOFF_MS;
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
  // ⚠️ `subscribeToMyNFLEntries` is now load-bearing for the commissioner, not just
  // the member. A commissioner is usually also a player, and their own entry is
  // what the three pick-entry forms render and edit — dropping the raw read
  // without this would make their own saved picks vanish while `getPoolPicks`
  // correctly refused to hand them back before the boundary.
  const [standingsRows, setStandingsRows] = useState<any[]>([]);
  // 🛑 STAMPED WITH THE POOL **AND** THE VIEWER, and checked at RENDER time — the
  // same rule `reveal` below already follows, for a sharper version of the same
  // reason. `PoolRoute` reuses this component across pool navigation and across
  // an account switch, so a snapshot outlives the pool and the uid that asked for
  // it.
  //
  // This used to be cleared by accident: the own-entry subscription reported a read
  // FAILURE by calling back with `null`, which happened to wipe the previous
  // pool's entry on the way past. That error contract is gone (it was telling a
  // member with a full sheet that they had not picked), so the guard that was
  // implicit has to become explicit — otherwise a new listener that errors before
  // its first snapshot leaves the PREVIOUS pool's, or the previous account's,
  // picks on screen and prefilled into this pool's pick sheet. (codex r1, P1.)
  //
  // PLAN-MULTI-ENTRY T4 — an ARRAY, because a member may hold several entries in
  // one pool. Empty means "this viewer owns none", which is a different fact
  // from `null` ("no snapshot has landed"); the two are still distinguished by
  // `ownEntryKnown` below, exactly as they were for the single entry.
  const [ownEntryState, setOwnEntryState] = useState<{ poolId: string; uid: string; entries: any[] } | null>(null);
  /**
   * Has a SUCCESSFUL snapshot for THIS pool and THIS viewer actually landed?
   *
   * 🛑 THE DIFFERENCE BETWEEN THIS AND `!!ownEntry` IS THE WHOLE POINT. An
   * entry that has not arrived and an entry that does not exist are different
   * facts, and only the second one licenses "you have not entered your picks".
   * `onSnapshot` TERMINATES a listener on error, so a transient rules or auth
   * failure on the FIRST snapshot means nothing ever arrives — and every surface
   * downstream would state the absent-entry fact anyway. That is the report
   * ("still says picks are not in until they refresh") reached through the
   * initial-error path rather than after a good snapshot. (codex r2, P2.)
   *
   * A signed-out viewer is `false` too, deliberately: they have no entry to load
   * and no picks to owe, so the checklist strip has nothing true to say to them.
   */
  const ownEntryKnown = !!user
    && ownEntryState !== null
    && ownEntryState.poolId === pool.id
    && ownEntryState.uid === user.id;
  const ownEntries = ownEntryKnown ? ownEntryState!.entries : [];
  const maxEntriesPerUser = effectiveMaxEntriesPerUser(castPool.settings);

  /**
   * WHICH of the viewer's entries every own-entry surface is about (T5/D7).
   *
   * 🛑 STAMPED WITH THE POOL, LIKE EVERY OTHER PIECE OF DERIVED VIEWER STATE
   * HERE. `PoolRoute` reuses this component across pool navigation and across an
   * account switch, so a selection made in one pool would otherwise name an
   * entry id that does not exist in the next — and the fallback below would
   * silently hand the member a DIFFERENT entry's pick sheet while the tab strip
   * showed their choice. Same rule `reveal` and `ownEntryState` already follow.
   *
   * `null` means "no explicit choice", which resolves to the primary entry.
   */
  const [activeEntrySel, setActiveEntrySel] = useState<{ poolId: string; uid: string; entryId: string } | null>(null);
  /** The draft entry the member is naming, before its first pick creates it. */
  const [entryDraft, setEntryDraft] = useState<{ poolId: string; uid: string; draft: EntryDraft } | null>(null);
  const pendingDraft = entryDraft && entryDraft.poolId === pool.id && entryDraft.uid === (user?.id || '')
    ? entryDraft.draft : null;

  const sortedOwnEntries = useMemo(() => sortOwnEntries(ownEntries), [ownEntries]);

  /**
   * 🛑 A DRAFT IS OVER THE MOMENT ITS ENTRY EXISTS (codex r2 P2 on the T5 PR).
   *
   * The draft's first successful submit CREATES the entry, and the entries
   * subscription delivers the new document a beat later. Without this the draft
   * would still be "live" — and `draft` forces `ownEntry` and `myEntry` to
   * `null`, so the sheet would keep behaving as an unsaved draft and HIDE the
   * saved state of the entry the member just created, until they happened to
   * click its tab.
   *
   * Derived rather than cleared in an effect: an effect would set state during
   * a snapshot-driven render and reintroduce exactly the one-paint lag the
   * `entries` memo above was rewritten to remove.
   */
  const fulfilledDraftEntry = pendingDraft
    ? sortedOwnEntries.find(e => (typeof e?.entryIndex === 'number' ? e.entryIndex : 1) === pendingDraft.entryIndex)
    : undefined;
  const draft = fulfilledDraftEntry ? null : pendingDraft;
  /**
   * The ACTIVE entry: the member's explicit choice when it still names an entry
   * they hold, otherwise their primary (lowest `entryIndex`).
   *
   * ⚠️ THE "STILL HOLD" CHECK IS NOT DEFENSIVE PADDING. A selection can name an
   * entry that has gone — a commissioner removing and re-adding a member deletes
   * their entries — and a dangling id would resolve to `undefined`, which every
   * pick surface reads as "you have not entered your picks".
   */
  const ownEntry = draft
    ? null
    : (fulfilledDraftEntry
        // The entry the member has just created stays selected — anything else
        // would bounce them back to entry #1 the instant their pick saved.
        ?? sortedOwnEntries.find(e => e.id === (activeEntrySel && activeEntrySel.poolId === pool.id && activeEntrySel.uid === (user?.id || '') ? activeEntrySel.entryId : null))
        ?? sortedOwnEntries[0]
        ?? null);
  /** The index the pick sheet submits under: the draft's, or the active entry's. */
  const activeEntryIndex: number = draft
    ? draft.entryIndex
    : (typeof ownEntry?.entryIndex === 'number' ? ownEntry.entryIndex : 1);
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
  //
  // 🛑 STAMPED WITH THE VIEWER TOO, NOT JUST THE POOL. The response is
  // per-principal now — a member sees other members' picks, a non-member sees
  // nothing — so a cache keyed only by pool would survive a sign-out,
  // account switch, or removal from the roster and keep rendering the previous
  // viewer's revealed picks to someone no longer entitled to them. (codex P1.)
  const [reveal, setReveal] = useState<{ poolId: string; uid: string; byWeek: Record<number, PoolPicksReveal> }>(
    { poolId: pool.id, uid: user?.id || '', byWeek: {} },
  );

  useEffect(() => {
    const unsubStandings = dbService.subscribeToNFLStandings(pool.id, setStandingsRows);
    const unsubOwn = user
      ? dbService.subscribeToMyNFLEntries(pool.id, user.id, (entries) =>
          setOwnEntryState({ poolId: pool.id, uid: user.id, entries }))
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

  // Shared fetch-and-merge. A response for another pool is discarded rather
  // than merged, which is the #430 cross-pool guard generalised to a map.
  const viewerUid = user?.id || '';
  // Every read of the cache goes through this — pool AND viewer must both match.
  const revealsForPool = reveal.poolId === pool.id && reveal.uid === viewerUid ? reveal.byWeek : {};
  const cachedWeeks = revealsForPool;
  // Grid columns still waiting on their deadline. These are the only weeks
  // besides the selected one whose answer can still change, so they are the
  // only ones the poll below re-requests.
  const openWeeks = gridWeeks.filter(w => w !== selectedWeek && !cachedWeeks[w]?.weekRevealed).join(',');
  // 🛑 AUTHORIZATION GENERATION. Bumped the moment the server declines this
  // viewer, and captured by every request before it goes out.
  //
  // Without it the denial handler below is defeated by ordering alone: a member
  // removed mid-flight can have an EARLIER successful response resolve AFTER
  // the denial that cleared the cache, quietly repopulating it — and, on the
  // participant's five-minute timer, leaving them looking at picks they are no
  // longer entitled to for the rest of that interval. A response from a
  // superseded generation is dropped rather than merged. (codex P1, r5.)
  const authGen = React.useRef(0);
  // A VIEWER CHANGE SUPERSEDES EVERYTHING IN FLIGHT, for the same reason a
  // denial does. Without this, a request issued as the previous user resolves
  // after the new user's and overwrites the cache with the OLD stamp — the
  // render guard then rejects it as mismatched and the new viewer sees "?"
  // everywhere until the next poll, which for a member is five minutes away.
  // Not a leak (the stamp holds), but a self-inflicted blackout. (codex P2, r6.)
  useEffect(() => { authGen.current += 1; }, [viewerUid, pool.id]);
  const loadWeek = React.useCallback((w: number) => {
    const gen = authGen.current;
    dbService.getPoolPicks(pool.id, w)
      .then(r => {
        // The request outlived its own entitlement — discard it.
        if (authGen.current !== gen) return;
        setReveal(prev => prev.poolId === pool.id && prev.uid === viewerUid
          ? { poolId: pool.id, uid: viewerUid, byWeek: { ...prev.byWeek, [w]: r } }
          : { poolId: pool.id, uid: viewerUid, byWeek: { [w]: r } });
      })
      // A refusal is not a crash — a non-member gets one and every surface then
      // renders "?", which is the honest answer — but the responses already in
      // hand were fetched under an entitlement the server has just declined to
      // renew. Keeping them would show a removed member the picks they could
      // see a minute ago, so the cache is EMPTIED and every in-flight request
      // is invalidated with it.
      .catch(err => {
        const denied = (err as { code?: string })?.code === 'functions/permission-denied';
        // 🛑 A DENIAL IS AN EXPECTED OUTCOME NOW, SO IT IS NOT A WARNING.
        // The tab is offered to every signed-in viewer, and a NON-member is
        // refused by the server by design — that is the whole shape of the
        // feature. Logging it at warn would put a recurring line in production
        // logs on a normal user path, every poll, and drown the failures that
        // do mean something. Classified BEFORE logging, not after. (qodo #9.)
        if (denied) logger.debug('[NFLPoolDashboard] getPoolPicks denied (not a member)');
        else logger.warn('[NFLPoolDashboard] getPoolPicks failed', err);
        // ⚠️ THE SAME GENERATION CHECK AS THE SUCCESS PATH, and it was missing
        // here — an asymmetry that inverted the guard's purpose. A denial from
        // a PREVIOUS pool or viewer, rejecting after navigation, would bump the
        // generation and stamp the old identity into state, invalidating the
        // NEW view's in-flight successful request and blanking a grid the
        // current viewer is fully entitled to. A superseded failure is as stale
        // as a superseded success. (codex P2, r7.)
        if (authGen.current !== gen) return;
        if (denied) {
          authGen.current += 1;
          setReveal({ poolId: pool.id, uid: viewerUid, byWeek: {} });
        }
      });
  }, [pool.id, viewerUid]);

  // (a) THE SELECTED WEEK — the only one whose answer can still change, so the
  // only one that polls or reacts to a `members` snapshot.
  //
  // Members poll five times slower than the commissioner: after this change
  // EVERY member of every pool polls this callable, where before only the
  // commissioner did, and the commissioner is the only one who needs
  // minute-fresh completeness to chase missing picks.
  //
  // 🛑 AND ONLY ON A TAB THAT ACTUALLY RENDERS IT. Three do: the picks grid,
  // the standings (its completeness column and the Survivor/Margin pick cell)
  // and the commissioner view. On Pool Home, My Entry, Recaps, Rules or
  // Payments the response is fetched and thrown away — which was free while one
  // commissioner did it and is not now that every member does. (codex P2, r3.)
  //
  // ⚠️ `members` DRIVES A REFRESH FOR THE COMMISSIONER ONLY. It changes on every
  // member-record write, i.e. every pick submission in the pool, and each call
  // scans the pool's entries — so leaving it in for participants makes one
  // submission fan out into a full-pool read per connected member. The
  // commissioner keeps it because their roster's "who still owes a pick" column
  // is the thing that has to be fresh the moment someone submits; a member's
  // view gains nothing before the reveal, and the timer covers it after.
  // Item 9: Results now opens a row's picks, so it wants the reveal too.
  const revealTabs: TabType[] = ['grid', 'standings', 'results', 'manager'];
  const wantsReveal = revealTabs.includes(activeTab);
  const commissionerRosterDep = isManager ? members : null;

  // 🛑 REMOVAL FROM THE ROSTER EMPTIES THE CACHE IMMEDIATELY.
  //
  // This closes a hole the `commissionerRosterDep` line above opens: dropping
  // `members` from a participant's dependencies stops the read fan-out, but it
  // also means a member removed WHILE VIEWING keeps rendering already-revealed
  // picks until the poll happens to collect a denial. The server refuses the
  // next call either way — but the cache is held HERE, so it is dropped here.
  //
  // ⚠️ THE SIGNAL IS `pool.participantIds`, AND THE OBVIOUS ONE DOES NOT WORK.
  // An earlier revision derived this from the `members` snapshot and skipped
  // the check when that array was empty, reading empty as "not loaded yet".
  // But `subscribeToPoolMembers` reports a PERMISSION ERROR by calling back
  // with `[]` (`dbService.ts:455`) — and losing the read is exactly what
  // removal causes. So the guard went quiet in the one case it was written
  // for: a guard that looks like a guard and is not. (qodo, re-review.)
  //
  // The pool document stays world-readable, removal does `arrayRemove(uid)` on
  // it, and K9 made it server-owned — so it keeps arriving and can be trusted.
  // Used ONLY to REVOKE cached data, never to grant access: admission is still
  // the canonical Member Record, server-side.
  const viewerStillMember = isManager || !viewerUid
    || !Array.isArray(castPool.participantIds)
    || castPool.participantIds.includes(viewerUid);
  useEffect(() => {
    if (viewerStillMember) return;
    authGen.current += 1;
    setReveal({ poolId: pool.id, uid: viewerUid, byWeek: {} });
  }, [viewerStillMember, pool.id, viewerUid]);
  useEffect(() => {
    if (!user || !wantsReveal) return;
    // The selected week, plus any grid column still waiting on its deadline —
    // those are the only weeks whose answer can still change. A revealed week
    // is a passed clock boundary and is never re-fetched.
    loadWeek(selectedWeek);
    const id = setInterval(() => loadWeek(selectedWeek), isManager ? 60_000 : 300_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, selectedWeek, commissionerRosterDep, user?.id, loadWeek, wantsReveal]);

  // (b) THE HISTORICAL COLUMNS of the Survivor/Margin grid — fetched ONCE each,
  // and only while that grid is actually on screen.
  //
  // 🛑 `members` IS DELIBERATELY NOT A DEPENDENCY HERE, and that is a cost fix
  // rather than a style choice. It changes on every member-record write, i.e.
  // every pick submission in the pool — and each participant call scans the
  // pool's members and entries. Sharing one effect with (a) turned a single
  // submission into one full-pool read per historical week PER CONNECTED
  // VIEWER: on a week-18 pool, eighteen. A past week's reveal is a clock
  // boundary that has already passed and cannot change, so it is fetched once
  // and kept. (codex P2.)
  // 🛑 "CACHED" MEANS REVEALED, NOT MERELY FETCHED. A viewer can select a LATER
  // week, which pulls earlier columns that have not reached their deadline yet
  // — and a `weekRevealed: false` response is a snapshot of a clock that is
  // still running.
  //
  // ⚠️ AND KEEPING THEM ON THE "MISSING" LIST IS NOT ENOUGH ON ITS OWN, which
  // is what an earlier revision of this fix got wrong: re-fetching an
  // unrevealed week returns another unrevealed response, so this string never
  // changes and the effect never re-runs. The column would still sit at "?"
  // after the deadline passed. They are therefore added to the POLL below —
  // the only thing here that fires on a clock. (codex r9, then r10 on r9's own
  // fix.)
  useEffect(() => {
    if (!user || activeTab !== 'grid' || pool.type === 'NFL_PICKEM') return;
    // 🛑 THE SINGLE OWNER of historical-column requests, including their retry.
    //
    // An earlier revision put the open-week loop in the poll above instead, and
    // that was wrong twice over: it ran on Standings and Manager, which consume
    // only the SELECTED week, and on the grid tab it duplicated this effect —
    // every historical callable issued twice, each one scanning the pool's
    // members and entries. Requests for these columns start and repeat here and
    // nowhere else. (codex r11.)
    const tick = () => {
      for (const w of openWeeks.split(',').filter(Boolean)) loadWeek(Number(w));
    };
    tick();
    const id = setInterval(tick, isManager ? 60_000 : 300_000);
    return () => clearInterval(id);
  }, [user?.id, activeTab, pool.type, openWeeks, loadWeek, isManager]);

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
      pool: castPool, members, standingsRows, ownEntries, reveal: weekReveal,
      // Survivor and Margin draw many weeks at once, so their rows need every
      // cached week's revealed picks — not just the selected week's, which
      // would render every earlier column as "made no pick". The per-column
      // reveal gate still lives in the cell. (codex P1.)
      weeklyReveals: pool.type === 'NFL_PICKEM' ? undefined : Object.values(revealsForPool),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [standingsRows, ownEntries, members, weekReveal, castPool.participantIds, pool.type, revealsForPool],
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
    // PLAN-MULTI-ENTRY §0b.3 — `.filter`, never `.find`. Where a SINGLE entry is
    // genuinely needed (the pick sheet, the CTA) it is the ACTIVE one (T5/D7);
    // taking the first match by uid would silently pick whichever row the fold
    // emitted first, which under multi-entry is not the member's choice.
    //
    // ⚠️ A DRAFT ENTRY HAS NO DOCUMENT AND MUST RESOLVE TO `null`, NOT TO
    // ANOTHER ENTRY. `ownEntry` is null while a draft is selected, and falling
    // through to the folded rows here would hand the empty new sheet the
    // PRIMARY entry's saved picks — pre-filled, and one click from overwriting
    // the wrong entry.
    if (draft) return null;
    if (ownEntry) return ownEntry;
    //
    // 🛑 AND ON A MULTI-ENTRY POOL, NEVER GUESS (codex r6, P1).
    //
    // Below this line the own-entry snapshot has NOT landed, and the only rows
    // in hand are the FOLD's — which carry no `entryIndex`, so they cannot be
    // matched to the active one. `mine[0]` is whichever the fold emitted first,
    // and the fold is ordered by the standings cascade: on a two-entry member
    // that can be entry #2 while `activeEntryIndex` is still 1. The sheet would
    // then DISPLAY entry #2's picks and SUBMIT them as entry #1 — a save that
    // copies one entry's sheet onto another, which is precisely the corruption
    // this plan exists to prevent.
    //
    // A single-entry pool keeps the fallback exactly as it was, because there
    // `mine[0]` is not a guess: it is the member's only entry.
    if (maxEntriesPerUser > 1) return null;
    const mine = entries.filter(e => e.ownerUid === user.id);
    return mine[0] || null;
  }, [ownEntry, draft, entries, user, maxEntriesPerUser]);

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
  // The whole computation is `shared/nflLockMode.ts` now — pure, shared with
  // `functions/`, and unit-tested in `tests/nfl-lockmode-invariants.test.ts`. It
  // used to be inline here, which is how it came to derive the week lock from
  // the earliest kickoff for every pool type and ignore `lockMode` entirely.
  const weekLock = useMemo(() => {
    void lockTick;
    const deadline = weekLockAtFor(castPool, selectedWeek, weeklyGames.map(g => g.startTime));
    return {
      deadline,
      locked: deadline !== null && serverNow() >= deadline,
      mode: nflLockMode(castPool.type, castPool.settings),
    };
  }, [weeklyGames, castPool, selectedWeek, lockTick]);

  /** The soonest lock still ahead of the member — what the countdown shows. */
  const nextLockAt = useMemo(() => {
    void lockTick;
    return nextLockAtFor(castPool, selectedWeek, weeklyGames.map(g => g.startTime), serverNow());
  }, [weeklyGames, castPool, selectedWeek, lockTick]);

  const isWeekLocked = weekLock.locked;

  // An ATS week whose lines are not all frozen: the pick sheet refuses to
  // render (`PickemPickEntry`) even though the time lock has not passed. The
  // Lock Status card below has to say so, or the two halves of one screen
  // contradict each other — "Spreads Not Yet Finalized" beside "PICKS ARE OPEN
  // / Make changes before kickoff", which is what preseason week 3 showed on
  // 2026-08-21.
  //
  // The card now derives that from `picksAvailability`, which wraps the SAME
  // `spreadsBlockWeek` predicate and also distinguishes an empty slate — so the
  // standalone memo went with it rather than leaving two derivations of one
  // fact on the page.

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

  // T1 — the pool's own colours, resolved and VALIDATED in one place.
  // `primaryColor` previously had no renderer at all and `bgColor` (which no
  // wizard collects) was the only thing driving the page, so a commissioner's
  // colour choices appeared to do nothing. See src/utils/brandingStyles.ts.
  /**
   * The pool feed (T9). Subscribed HERE rather than inside `BanterFeed` so the
   * manager card and the member Overview render the same data from one reader,
   * and so a failed read is distinguishable from an empty feed - `onSnapshot`
   * TERMINATES a listener on error, and "nothing posted yet" for a permission
   * failure is the silence-as-success defect this repo keeps finding.
   */
  const [poolFeed, setPoolFeed] = useState<BanterMessage[]>([]);
  const [poolFeedError, setPoolFeedError] = useState(false);
  /**
   * Membership, read the same way the Firestore rule reads it — ALL FOUR of
   * `isPoolParticipant()`'s branches, not just participantIds (codex r4 [P2]).
   * An owner or legacy manager absent from that array, and a super admin, are
   * authorized to read the feed; a narrower client gate would hide it from
   * exactly the people the backend lets in.
   *
   * Subscribing as a non-member terminates the listener on a permission error,
   * so this gate is also what keeps a public-pool visitor from seeing a
   * permanent feed error.
   */
  const isPoolMember = !!user?.id && (
    castPool.ownerId === user.id ||
    castPool.managerUid === user.id ||
    (Array.isArray(castPool.participantIds) && castPool.participantIds.includes(user.id)) ||
    isSuperAdmin(user)
  );

  useEffect(() => {
    if (!pool?.id || !isPoolMember) return;
    return dbService.subscribeToPoolFeed(
      pool.id,
      (messages) => { setPoolFeedError(false); setPoolFeed(messages); },
      () => setPoolFeedError(true),
    );
  }, [pool?.id, isPoolMember]);

  /**
   * The pinned post (Kevin, 2026-08-23), watched as its OWN document rather
   * than looked up in `poolFeed`: that array is the last 50 messages, so a pin
   * set early in a chatty pool would silently stop rendering once it aged out.
   *
   * The id it belongs to is carried in state ALONGSIDE the message, so a
   * snapshot that arrives for a pin the commissioner has since changed cannot
   * be rendered under the new id — and so clearing the band when the pin is
   * removed needs no setState in an effect body (a cascading render, and a lint
   * error in this repo).
   */
  // Validated on the way IN as well as on the way out (codex r1 [P2]). The
  // callable refuses to store a value that is not a safe document id, but a
  // pool document predating that check — or written by the Admin SDK, which
  // never sees it — must not be able to throw `doc()` inside the effect below
  // and take the pool home page down for every member.
  const rawPinnedId = castPool.pinnedMessageId as unknown;
  const pinnedMessageId = isPinnableMessageId(rawPinnedId) ? rawPinnedId : '';
  const [pinned, setPinned] = useState<{ id: string; message: BanterMessage | null; error: boolean }>(
    { id: '', message: null, error: false },
  );
  useEffect(() => {
    if (!pool?.id || !isPoolMember || !pinnedMessageId) return;
    return dbService.subscribeToPinnedMessage(
      pool.id,
      pinnedMessageId,
      (message) => setPinned({ id: pinnedMessageId, message, error: false }),
      () => setPinned({ id: pinnedMessageId, message: null, error: true }),
    );
  }, [pool?.id, isPoolMember, pinnedMessageId]);
  const pinnedMessage = pinned.id === pinnedMessageId ? pinned.message : null;
  const pinnedError = pinned.id === pinnedMessageId && pinned.error;

  const branding = castPool.branding || {};
  const brand = brandingStyles(branding);
  const accentHex = brand.accent;

  // ── The at-a-glance strip (testers, 2026-08-23) ────────────────────────────
  // The pool-card identity chips plus the three numbers people open the page
  // to check: players, who leads the week, who leads the season. All derived
  // from data already on this page — no new reads.
  const typeLabel = poolTypeLabel(castPool);
  const optionLabels = poolOptionLabels(castPool);
  // `participantIds` is the world-readable, server-owned roster signal (K9),
  // so the count works for signed-out visitors too; `members` needs a read
  // that non-members are denied.
  const participantCount = Array.isArray(castPool.participantIds)
    ? castPool.participantIds.length
    : members.length;
  const glance = useMemo(() => {
    const name = (e: { userName?: string }) => e.userName || 'Anonymous';
    // Two names print; a bigger tie prints the first plus a count — this strip
    // must stay one short row, and a 24-way survivor "tie" is the normal state.
    const label = (list: { userName?: string }[]) =>
      list.length === 0 ? null : list.length > 2 ? `${name(list[0])} +${list.length - 1}` : list.map(name).join(', ');
    // `unscored` rows are a late entrant with no scored week yet — the
    // standings deliberately rank them LAST, and comparing them here as zero
    // would crown one in a Margin pool whose real totals are negative.
    // (codex r1, P2.)
    const ranked = entries.filter(e => !e.unscored);
    // `seasonCompare` is the standings table's OWN cascade — a shallower copy
    // here disagreed with it on every tiebreaker below the first (codex r2,
    // P2). Rows it calls equal are genuinely tied and share the lead.
    const sorted = [...ranked].sort((a, b) => seasonCompare(pool.type, a, b));
    const seasonLeaders = sorted.filter(e => seasonCompare(pool.type, e, sorted[0]) === 0);
    // Week leader: the recap's winner line is the scored truth and wins when
    // it exists; before the week is fully scored, the live projection's
    // per-week value ranks. `weekValueFor` is the standings' own accessor —
    // Pick'em publishes `weeklyPoints`, Margin `weeklyScores`, and hand-rolling
    // the field here read the wrong one for Pick'em (codex r1, P2). Never
    // fabricated — an unscored week shows a dash.
    const recap = recaps.find(r => r.week === selectedWeek);
    let weekLeaders: { userName?: string }[] = [];
    if (recap?.weeklyWinners?.length) {
      weekLeaders = recap.weeklyWinners;
    } else if (pool.type !== 'NFL_SURVIVOR') {
      const isMargin = pool.type === 'NFL_MARGIN';
      const scored = ranked.filter(e => weekValueFor(e, selectedWeek, isMargin) !== null);
      if (scored.length) {
        const top = Math.max(...scored.map(e => weekValueFor(e, selectedWeek, isMargin) as number));
        weekLeaders = scored.filter(e => weekValueFor(e, selectedWeek, isMargin) === top);
      }
    }
    // A pool where nothing has been scored has no leader — everyone "ties" at
    // zero and the strip would crown an arbitrary first name. Dash until any
    // entry carries a scored week, a strike, or an elimination.
    const anyScored = entries.some(e =>
      Object.keys(e.weeklyPoints || {}).length > 0 ||
      Object.keys(e.weeklyScores || {}).length > 0 ||
      Object.keys(e.weeklyResults || {}).length > 0 ||
      (e.strikesUsed || 0) > 0 || e.status === 'ELIMINATED');
    return {
      seasonLeader: anyScored ? label(seasonLeaders) : null,
      weekLeader: label(weekLeaders),
      alive: entries.filter(e => e.status !== 'ELIMINATED').length,
    };
  }, [entries, recaps, selectedWeek, pool.type]);

  // Billing is C9: owner-only, never a co-commissioner — so the gate reads the
  // STRICT helper, not the NFL-widened `isManager` prop (codex r8 on PR-B).
  return (
    <BillingGate pool={pool as any} isCommissioner={isPoolManager(user, pool)}>
    {/* T2: `activeTab` — the tab the pool ACTUALLY rendered, which is not always
        the one `?tab=` asked for (an unoffered tab falls back to dashboard). The
        Help panel must describe the screen, not the link.

        `tabOffered` goes with it, so Help never lists a screen this pool has no
        tab for: Survivor has no Results, and the picks grid and payments need a
        signed-in reader. Published rather than re-derived in the help content,
        which would be a second copy of a rule that changes here. */}
    <HelpRoutePublisher
      tab={activeTab}
      isManager={isManager}
      /* T10: `results` is filtered OUT even where it is still "offered" as a
         URL. It is an alias, not a screen, and publishing it would let Help
         list a tab this pool's strip does not have. */
      offeredTabs={VALID_TABS.filter(t => t !== 'results' && tabOffered[t])}
    />
    <div
      className="min-h-screen bg-page text-[color:var(--text)] font-body pb-20 relative transition-colors duration-500"
      style={brand.page}
    >
      {/* Pool Header Bar */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div
          className="bg-card border border-line rounded-xl shadow-card overflow-hidden"
          style={brand.headerCard}
        >
          {/* THE BRANDED HEADER BAND (Kevin, 2026-08-24, option (ii)).

              A solid bar of the pool's primary colour carrying the logo, the
              pool name and the format. It is the one branded element a member
              cannot miss, and it is theme-safe BY CONSTRUCTION: it paints both
              its own background and its own text colour (`readableTextOn`), so
              it reads no theme token and cannot be wrong in light or dark mode.

              ⚠️ Rendered ONLY when the pool set a usable primary. Without one,
              `brand.themed` is false and the fallback block below renders the
              header exactly as it did before — no empty bar, no layout shift.

              `overflow-hidden` on the card is what makes the band reach the
              rounded corners; without it the colour squares them off. */}
          {brand.themed && (
            <div className="px-6 py-4 flex items-center gap-3 flex-wrap" style={brand.headerBand}>
              {branding.logoUrl && (
                <img src={branding.logoUrl} className="h-12 w-auto object-contain drop-shadow" alt="Logo" />
              )}
              {/* The pool name is the way HOME (2026-08-23 redesign) — the
                  affordance every site header trains: click the title, land on
                  the main view. Inherits the band's ink; the button nests
                  inside the h1, which is valid HTML (the reverse is not). */}
              <h1 className="font-display font-extrabold uppercase text-2xl md:text-3xl leading-none">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  title="Back to Pool Home"
                  className="uppercase text-left hover:opacity-80 transition-opacity"
                >
                  {pool.name}
                </button>
              </h1>
              <span
                className="font-display font-bold uppercase text-[12px] tracking-[0.08em]"
                style={brand.headerBandMuted}
              >
                {pool.type === 'NFL_PICKEM' ? 'Weekly Pick\'em' :
                 pool.type === 'NFL_SURVIVOR' ? 'Survivor Pool' : 'Margin Pool'}
              </span>
            </div>
          )}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-6">
          <div>
            {/* The unbranded header, unchanged. A pool with no primary colour
                still gets its logo and name here rather than nowhere. */}
            {!brand.themed && (
              <div className="flex items-center gap-3 mb-1">
                {branding.logoUrl && (
                  <img src={branding.logoUrl} className="h-12 w-auto object-contain drop-shadow" alt="Logo" />
                )}
                <h1 className="font-display font-extrabold uppercase text-2xl md:text-3xl text-[color:var(--text)] leading-none">
                  <button
                    onClick={() => setActiveTab('dashboard')}
                    title="Back to Pool Home"
                    className="uppercase text-left hover:opacity-80 transition-opacity"
                  >
                    {pool.name}
                  </button>
                </h1>
              </div>
            )}
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
              {/* The format label moved INTO the band when there is one, so it
                  is not printed twice. */}
              {!brand.themed && (
                <>
                  <span className="text-faint">•</span>
                  <span className="text-navy-700 dark:text-gold-400 uppercase font-display font-bold text-[12px] tracking-[0.08em]">
                    {pool.type === 'NFL_PICKEM' ? 'Weekly Pick\'em' :
                     pool.type === 'NFL_SURVIVOR' ? 'Survivor Pool' : 'Margin Pool'}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex gap-2.5 items-center flex-wrap">
            {/* The week dropdown lived here until 2026-08-23. It duplicated
                the week checklist strip right below the header — two controls
                for the same URL param — and "repetitive" was Kevin's word.
                The chips are now the one week selector. */}
            <Button variant="ghost" size="sm" onClick={handleShare}>
              <Share2 size={13} /> Invite Link
            </Button>

            {isManager && (
              <Button variant="secondary" size="sm" style={brand.primaryButton} onClick={() => setActiveTab('manager')}>
                <Settings size={13} /> Commissioner
              </Button>
            )}

            {/* Moved out of the bento sidebar when that menu was deleted
                (2026-08-23) — navigation back to My Entries, nothing more. */}
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft size={13} /> Leave Pool
            </Button>
          </div>
        </div>

        {/* At-a-glance strip: what kind of pool this is + who's in it + who
            leads. One compact row on the header card's bottom edge. */}
        <div
          data-testid="pool-home-glance"
          className="px-6 py-2.5 border-t border-line flex flex-wrap items-center gap-x-6 gap-y-1.5"
        >
          <span className="flex items-center gap-1.5 flex-wrap" data-testid="pool-home-type">
            <span className="text-[10px] font-display font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border border-[#E4DFD3] bg-cream text-navy-800">{typeLabel}</span>
            {optionLabels.map(o => (
              <span key={o} className="text-[11px] font-body text-muted">{o}</span>
            ))}
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={12} className="text-muted" aria-hidden="true" />
            <span className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-muted">Players</span>
            <span className="text-[13px] font-display font-bold num text-[color:var(--text)]">{participantCount}</span>
          </span>
          {pool.type === 'NFL_SURVIVOR' ? (
            <span className="flex items-center gap-1.5">
              <Flame size={12} className="text-brandred-600" aria-hidden="true" />
              <span className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-muted">Alive</span>
              <span className="text-[13px] font-display font-bold num text-[color:var(--text)]">
                {entries.length ? `${glance.alive} of ${entries.length}` : '—'}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Trophy size={12} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
              <span className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-muted">{nflWeekLabel(seasonType, selectedWeek)} Leader</span>
              <span className="text-[13px] font-display font-bold text-[color:var(--text)]">{glance.weekLeader ?? '—'}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Crown size={12} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
            <span className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-muted">Season Leader</span>
            <span className="text-[13px] font-display font-bold text-[color:var(--text)]">{glance.seasonLeader ?? '—'}</span>
          </span>
        </div>
        </div>

        {/* THE pool nav — one strip, directly under the header (2026-08-23
            mobile redesign: "standings are too far down, too many menus").
            Sticky on mobile so every section stays one tap away at any scroll
            depth; static on md+ where content has room. It stacks BELOW the
            site header, which is sticky on every page (codex r2/r3): top-[73px]
            is that header's measured mobile height (px-4 py-3 + h-12 logo +
            border) — if the header's mobile chrome changes, this offset moves
            with it. bg-page is solid on purpose — content must not ghost
            through while stuck. (On a branded pool the page tint differs
            slightly behind it; cosmetic, and beats a translucent smear.) */}
        <nav
          aria-label="Pool sections"
          className="sticky top-[73px] z-40 md:static -mx-4 px-4 md:mx-0 md:px-0 mt-4 bg-page border-b border-line flex overflow-x-auto whitespace-nowrap scrollbar-hide"
        >
          {TAB_STRIP.filter(({ tab }) => tabOffered[tab]).map(({ tab, label }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              className={`py-3 px-4 md:px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
                activeTab === tab
                  ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                  : 'text-muted hover:text-[color:var(--text)] border-transparent'
              }`}
              style={activeTab === tab ? { borderBottomColor: accentHex } : {}}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Week-by-week pending/done strip + "picks due" call-to-action */}
        {!isLoading && (
          <div className="mt-6">
            <WeekChecklist
              primaryButtonStyle={brand.primaryButton}
              pool={pool}
              entryKnown={ownEntryKnown}
              entry={myEntry}
              games={games}
              selectedWeek={selectedWeek}
              onSelectWeek={setSelectedWeek}
              onPickNow={(week) => { setSelectedWeek(week); setActiveTab('picks'); }}
            />
          </div>
        )}

        {/* Tab View Routers */}
        <div className="space-y-6 mt-6">
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
                    activeEntryId={ownEntry?.id ?? null}
                    pendingEntryLabel={draft ? (draft.entryName.trim() || `Entry ${draft.entryIndex}`) : undefined}
                    games={games}
                    entries={entries}
                    recaps={recaps}
                    selectedWeek={selectedWeek}
                    setSelectedWeek={setSelectedWeek}
                    isWeekLocked={isWeekLocked}
                    earliestGame={earliestGame}
                    weekLockAt={weekLock.deadline}
                    onSelectTab={(tab) => setActiveTab(tab)}
                    /* T9's feed and the pinned band render INSIDE the bento now
                       (Kevin, 2026-08-23): the feed beside Pool Standings rather
                       than at the bottom of the page - "The bottom of the page
                       is useless" - and the pin directly under the score ticker,
                       which is the ticker's own component.

                       Still subscribed HERE, for the reason T9 gave: one reader
                       feeds both the member view and the commissioner card, so
                       they cannot drift, and a failed read stays distinguishable
                       from an empty feed. */
                    poolFeed={poolFeed}
                    poolFeedError={poolFeedError}
                    isPoolMember={isPoolMember}
                    pinnedMessage={pinnedMessage}
                    pinnedError={pinnedError}
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
                        {/*
                          My Entries (T5/D7). Renders nothing when the pool
                          allows one entry each, which is every pool until
                          `MULTI_ENTRY_WIZARD_ENABLED` flips — so a single-entry
                          pool's pick tab is unchanged, pixel for pixel.
                        */}
                        <EntrySwitcher
                          ownEntries={ownEntries}
                          maxEntries={maxEntriesPerUser}
                          userName={user?.name || 'Entry'}
                          activeEntryId={ownEntry?.id ?? null}
                          activeEntryIndex={activeEntryIndex}
                          onSelectPrimarySlot={() => setEntryDraft({
                            poolId: pool.id,
                            uid: user?.id || '',
                            // Entry #1 starts BLANK rather than pre-filled: an
                            // empty name means "use my player name", which is
                            // exactly today's behaviour, so opening the slot
                            // changes nothing unless the member types.
                            draft: { entryIndex: 1, entryName: '' },
                          })}
                          onSelect={(entryId) => {
                            setEntryDraft(null);
                            setActiveEntrySel({ poolId: pool.id, uid: user?.id || '', entryId });
                          }}
                          draft={draft}
                          onStartDraft={() => {
                            const next = nextAddableEntryIndex(ownEntries, maxEntriesPerUser);
                            if (next === null) return;
                            setEntryDraft({
                              poolId: pool.id,
                              uid: user?.id || '',
                              draft: { entryIndex: next, entryName: defaultEntryName(user?.name || 'Entry', next) ?? '' },
                            });
                          }}
                          onDraftNameChange={(entryName) => setEntryDraft(prev => prev
                            ? { ...prev, draft: { ...prev.draft, entryName } }
                            : prev)}
                          onCancelDraft={() => setEntryDraft(null)}
                          isWeekLocked={isWeekLocked}
                          /*
                            Rename an entry that EXISTS. Rejections propagate on
                            purpose — EntrySwitcher renders the server's own
                            refusal (ENTRY_NAME_TAKEN) beside the input rather
                            than a toast that leaves the field looking saved.
                            No local state to update: the entries subscription
                            delivers the new name a beat later, same as a submit.
                          */
                          onRename={(entryIndex, entryName) =>
                            dbService.renameNFLEntry(pool.id, entryIndex, entryName)}
                        />

                        {pool.type === 'NFL_PICKEM' && (
                          <PickemPickEntry
                            pool={pool}
                            user={user}
                            week={selectedWeek}
                            games={weeklyGames}
                            seasonGames={games}
                            entry={myEntry}
                            entryIndex={activeEntryIndex}
                            entryName={draft?.entryName}
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
                            entryIndex={activeEntryIndex}
                            entryName={draft?.entryName}
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
                            entryIndex={activeEntryIndex}
                            entryName={draft?.entryName}
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
                            {/* ONE derivation for the header AND the notice below
                                it (codex r2). Keying the header off
                                `spreadsBlocked` alone left an empty slate saying
                                "Picks are Open" directly above "there is nothing
                                to pick" — two contradictory claims on one card. */}
                            {(() => {
                              const availability = picksAvailability(castPool, weeklyGames, { weekLocked: isWeekLocked });
                              const open = availability.kind === 'OPEN';
                              const heading = isWeekLocked ? 'Selections Locked'
                                : availability.kind === 'NO_GAMES' ? 'No Games Yet'
                                : availability.kind === 'WAITING_ON_SPREADS' ? 'Waiting on Spreads'
                                : 'Picks are Open';
                              const sub = isWeekLocked ? 'Host is syncing game outcomes.'
                                : availability.kind === 'NO_GAMES' ? 'This week’s schedule has not been posted yet.'
                                : availability.kind === 'WAITING_ON_SPREADS' ? 'The sheet opens once every line for this week is frozen.'
                                : 'Make changes before kickoff.';
                              return (
                                <>
                                  <div className="flex items-center gap-3">
                                    {open ? (
                                      <div className="p-2.5 bg-[#E5EDF6] rounded-md text-[#142A4C] border border-[#CBDCEC] animate-pulse">
                                        <Calendar size={18} />
                                      </div>
                                    ) : (
                                      <div className="p-2.5 bg-cream rounded-md text-muted border border-line">
                                        <Lock size={18} />
                                      </div>
                                    )}
                                    <div>
                                      <h4 className="font-display font-bold uppercase text-sm text-[color:var(--text)]">{heading}</h4>
                                      <p className="font-body text-[11px] text-muted">{sub}</p>
                                    </div>
                                  </div>

                                  {/* WHEN THE SHEET OPENS — above the lock block,
                                      because a member who cannot pick yet is
                                      asking "until when?", and the only answer on
                                      this card used to be "once every line is
                                      frozen" with no date (Kevin, 2026-08-28).
                                      Silent once the week has locked: the header
                                      already says it. */}
                                  {availability.notice && (
                                    <div className={`p-3 rounded-lg border text-center ${open ? 'bg-page border-line' : 'bg-gold-400/10 border-gold-500/30'}`}>
                                      <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted block mb-1">
                                        {open ? 'Picks open now' : 'Picks open'}
                                      </span>
                                      <span className={`font-body text-[12px] ${open ? 'text-[color:var(--text)]' : 'text-gold-700 dark:text-gold-300'}`}>
                                        {availability.notice}
                                      </span>
                                    </div>
                                  )}
                                </>
                              );
                            })()}

                            {/* COUNTS DOWN TO THE NEXT LOCK, not the week's.
                                On a PER_GAME pool the week deadline is the LAST
                                game's, so counting down to it would tell a
                                member they have until Sunday evening to make a
                                Thursday pick. `nextLockAt` is the soonest lock
                                still ahead of them, which is the one they are
                                about to lose. On a weekly pool the two are the
                                same value and the label is unchanged. */}
                            {nextLockAt !== null && !isWeekLocked && (
                              <div className="bg-page p-3 rounded-lg text-center border border-line">
                                <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted block mb-1">
                                  {weekLock.mode === 'PER_GAME' ? 'Next pick locks' : 'Locks in'}
                                </span>
                                <span className="text-gold-600 dark:text-gold-400 num font-bold text-sm">
                                  {new Date(nextLockAt).toLocaleString()}
                                </span>
                                <CountdownTo deadline={nextLockAt} onExpire={() => setLockTick(t => t + 1)} />
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
                    ownEntryLoaded={ownEntryKnown}
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
                    ownEntryLoaded={ownEntryKnown}
                  />
                )
              )}

              {/* TAB 2: STANDINGS — season / week / summary in ONE tab (T10).
                  The weekly and season tables are the same tested components
                  that used to sit on two tabs; only the parent changed. */}
              {activeTab === 'standings' && (
                <NFLStandingsTab
                  pool={pool}
                  entries={entries}
                  games={games}
                  week={selectedWeek}
                  viewerUid={user?.id}
                  pickCounts={weekReveal?.counts}
                  reveal={weekReveal}
                  ownEntryLoaded={ownEntryKnown}
                  scope={standingsScope}
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

                          {/* The Weekly Winners List (PLAN-WEEKLY-PRIZES B2):
                              every place, straight off the recap — the client
                              never re-ranks or re-prices (§3a). Absent on
                              recaps written before it existed. */}
                          {pool.type !== 'NFL_SURVIVOR' && (
                            <div className="pt-2 border-b border-line pb-2">
                              <WeeklyWinnersList recap={recap} poolType={pool.type} />
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
                <PaymentsPanel pool={pool} user={user} entries={entries} members={members} isManager={isManager} onManagePayments={() => setActiveTab('manager', 'members')} />
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
                  initialSection={searchParams.get('section')}
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
