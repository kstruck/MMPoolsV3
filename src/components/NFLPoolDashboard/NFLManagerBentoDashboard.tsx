import React, { useState, useMemo, useEffect } from 'react';
import type { User as UserType, Pool, NFLGame, BanterMessage } from '../../types';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { useToast } from '../ui/Toast';
import { Badge } from '../ui';
import {
  Volume2,
  Send,
  Activity,
  CheckCircle,
  AlertCircle,
  PartyPopper,
  Sparkles
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';
import { gamesForPoolWeek, weekDeadline, poolSeasonType } from '../../utils/nflPending';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { effectiveBufferMinutesForWeek, usesWeeklyHardLock } from '@shared/weeklyHardLock';
import { buildPoolRoster, rosterPotStats, outstandingDue, duesRates, memberOutstanding, unsubmittedRoster } from '../../utils/poolRoster';
import { BanterFeed } from './BanterFeed';
import { formatDeadline } from '../../utils/formatTime';

interface NFLManagerBentoDashboardProps {
  pool: Pool;
  entries: any[];
  /** Member Records — roster + payment truth, incl. members with no entry (ADR 0003) */
  members: any[];
  games: NFLGame[];
  week: number;
  user: UserType | null;
  /**
   * uid → games picked this week, from `getPoolPicks`
   * (PLAN-COMMISSIONER-BLIND-PICKS D1). The commissioner no longer holds other
   * members' entry documents, so this is now the ONLY source for pick
   * completeness before the reveal boundary. Undefined while the callable is in
   * flight, in which case `unsubmittedRoster` falls back to entry inspection.
   */
  pickCounts?: Record<string, number>;
  onSelectTab: (tab: 'picks' | 'standings' | 'recaps' | 'rules' | 'manager') => void;
  /** "View full ledger" opens THE Payment Ledger (Members & Payments) — one ledger, one door (Kevin, 2026-08-16). */
  onOpenLedger?: () => void;
}

export const NFLManagerBentoDashboard: React.FC<NFLManagerBentoDashboardProps> = ({
  pool,
  entries,
  members,
  games: _games,
  week,
  user: _user,
  pickCounts,
  onSelectTab: _onSelectTab,
  onOpenLedger,
}) => {
  const castPool = pool as any;
  const toast = useToast();
  const [aiMood, setAiMood] = useState<'savage' | 'professional' | 'analyst'>('savage');
  const [banterText, setBanterText] = useState('');
  const [banterBusy, setBanterBusy] = useState<null | 'post' | 'ai'>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const pinnedMessageId = (castPool.pinnedMessageId as string | undefined) ?? '';
  const [feedError, setFeedError] = useState(false);
  const aiUnlocked = castPool.billing?.featuresUnlocked?.aiCommissioner === true;
  // The feed is PERSISTED now (T9). It used to be `useState<string[]>` seeded
  // with invented commissioner analysis — a claim that the current leader had a
  // history of collapsing late in the season, where the top-player fallback on
  // an empty pool was a mock name lifted from DevDashboardPreview, so a
  // one-player pool that had never played a week was shown a scouting report on
  // a rival. That is gone twice over: the seed, and the whole local-only store.
  //
  // Posts live in `pools/{id}/messages` and every member reads the same feed on
  // the Overview tab, which is what Kevin asked for ("where are these messages
  // shown to members?").
  //
  // tests/admin-surface-invariants.test.ts asserts the removed strings are
  // absent from this FILE, comments included. Paraphrase them; never quote them
  // back in, or the guard fails on the explanation of its own defect.
  const [banterFeed, setBanterFeed] = useState<BanterMessage[]>([]);

  useEffect(() => {
    if (!pool?.id) return;
    return dbService.subscribeToPoolFeed(
      pool.id,
      (messages) => { setFeedError(false); setBanterFeed(messages); },
      () => setFeedError(true),
    );
  }, [pool?.id]);

  /**
   * Generation is ASYNCHRONOUS (codex r5 [P2]). "Asked the AI" is an optimistic
   * toast; if the provider fails, the model returns nothing, or authority was
   * revoked in between, the request is marked ERROR and no post ever arrives.
   * Without this the commissioner waits for something that is not coming.
   */
  const [lastBanterRequest, setLastBanterRequest] = useState<{ status: string; error?: string } | null>(null);
  useEffect(() => {
    if (!pool?.id || !_user?.id) return;
    return dbService.subscribeToMyBanterRequests(pool.id, _user.id, (reqs) => {
      setLastBanterRequest(reqs[0] ?? null);
    });
  }, [pool?.id, _user?.id]);

  const [isNudging, setIsNudging] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Both payment writes go through setPaidStatus — the AUTHORITATIVE path
  // (PLAN-PAYMENT-TRUTH P1 / D13). The old updateEntryPayment callable wrote
  // only the display-legacy entry doc, so a commissioner using this panel
  // marked someone paid while the Member Record, the payments ledger, the
  // roster summary and the pot all still said UNPAID. setPaidStatus writes the
  // Member Record as truth and mirrors the display fields onto the entry in
  // the same transaction.
  //
  // Every row on this card is now a ROSTER row keyed by uid, so no entry-id
  // indirection is needed: an entry-derived row could not name a member who has
  // no entry, which is exactly why this card showed "no members".
  //
  // Both handlers report the SERVER's reason instead of a hardcoded string. That
  // matters more now than it did: `setPaidStatus` throws `not-found` ("Member is
  // not on this pool's roster") when no Member Record exists, and the roster this
  // card renders deliberately falls back to participantIds and entries, so it can
  // list someone the write path will reject. The P4 backfill makes that rare —
  // 152 records present, 0 to create on its last prod dry run — but the old copy
  // blamed permissions or the network for it, which is the wrong thing to debug.
  //
  // codex r4: routing that case through getUserMessage alone was NOT enough.
  // `setPaidStatus` uses `not-found` for BOTH "Pool not found" and "Member is not
  // on this pool's roster", and getUserMessage matches the transport CODE
  // (`functions/not-found`) before it ever looks at the message — so the roster
  // case still rendered as "that pool or entry couldn't be found", sending the
  // commissioner to look for a missing pool that is plainly on their screen.
  //
  // Disambiguated by what the CLIENT already knows — `hasMember` on the roster
  // row — rather than by pattern-matching the server's prose, which would break
  // silently the day that sentence is reworded. This only EXPLAINS an error that
  // already happened; it never pre-blocks the write, so a record created since
  // the last snapshot still goes through.
  //
  // The durable fix is a domain prefix on the server error (getUserMessage
  // already resolves `/^[A-Z_]{4,}:/` ahead of the code), but that is a
  // functions/ change and this PR is frontend-only. Recorded in
  // PLAN-PAYMENT-TRUTH §6b for the next PR that touches functions/.
  const paymentError = (err: unknown, hasMember: boolean, fallback: string): string =>
    hasMember
      ? getUserMessage(err, fallback)
      : 'This person has no roster record yet, so their payment cannot be set here. Have them rejoin the pool, or run the Member Record backfill from the SuperAdmin Operations tab.';

  const togglePayment = async (uid: string, currentPaid: boolean, hasMember: boolean) => {
    setTogglingId(uid);
    try {
      await dbService.setPaidStatus(pool.id, uid, !currentPaid);
    } catch (err) {
      console.error("Failed to update payment status:", err);
      toast.error(paymentError(err, hasMember, 'Failed to update payment status. Please try again.'));
    } finally {
      setTogglingId(null);
    }
  };

  // Roster truth for every money figure and every member row on this card
  // (utils/poolRoster — the same merge the Member Roster panel below uses).
  const roster = useMemo(
    () => buildPoolRoster({ pool, members, entries })
      .map(r => ({ ...r, displayName: r.userName || 'Member' }))
      .sort((a, b) => (a.isOwner ? -1 : b.isOwner ? 1 : a.displayName.localeCompare(b.displayName))),
    [pool, members, entries],
  );

  // Derived unsubmitted players list — ROSTER-derived, not entries-derived.
  //
  // This was the last surface on this card still reading `entries` alone, and it
  // is the same defect #322 fixed for the money figures: a member who joined but
  // has never submitted has a Member Record and NO entry document, so an
  // entries-derived reader cannot see them. They appeared in neither the total
  // nor the pending list, and readiness was computed over a SUBSET of the pool —
  // so one submitted entry beside three joined-but-unpicked members read
  // "1 of 1 — 100%". A commissioner checking pick readiness on kickoff night was
  // told everyone was in while three quarters of the room was not.
  //
  // The rule itself lives in utils/poolRoster (`unsubmittedRoster`) so it can be
  // unit-tested; see the note there on why it is not inline.
  const weeklyGames = useMemo(() => gamesForPoolWeek(_games, castPool, week), [_games, castPool, week]);
  const unsubmittedPlayers = useMemo(
    () => unsubmittedRoster(roster, {
      poolType: pool.type,
      week,
      weeklyGameIds: weeklyGames.map(g => g.id),
      pickCounts,
    }).map(r => ({
      id: r.entry?.id || r.uid,
      uid: r.uid,
      // `roster` rows carry the card's own displayName fallback; the helper is
      // typed on the bare RosterRow, so re-apply it rather than widen the type.
      name: r.userName || 'Member',
      email: r.email || '',
      // The nudge callable resolves its targets from the ENTRIES collection
      // (functions/src/manualReminders.ts:66-72), so it cannot reach a member
      // who has never submitted — exactly the rows this fix made visible.
      hasEntry: r.hasEntry,
      hasMember: r.hasMember,
    })),
    [roster, week, pool.type, weeklyGames, pickCounts],
  );

  // 1. Calculations for Pick submissions status — denominator is the ROSTER.
  // Everyone on it is expected to pick, the commissioner included (Kevin's
  // ruling 2026-07-31: managers play ~99% of the time). Numerator and
  // denominator therefore run over the same set, which is the property that
  // stops this card contradicting itself.
  const submissionStats = useMemo(() => {
    const total = roster.length;
    const pendingCount = unsubmittedPlayers.length;
    const submitted = total - pendingCount;
    const percentage = total > 0 ? Math.round((submitted / total) * 100) : 0;
    return { total, submitted, pendingCount, percentage };
  }, [roster, unsubmittedPlayers]);

  // Financial Ledger calculations — roster-derived, so a member who joined but
  // has not submitted an entry is counted. This card previously read `entries`
  // alone AND defaulted a missing entryFee to 20, so a real pool could report
  // both "$0 collected of $0" and a $20-per-head pot that was never owed.
  const pot = useMemo(() => rosterPotStats({ pool, members, entries }), [pool, members, entries]);

  // Filtered by DEBT, not by paid status (codex r5). A seeded owner carries
  // `feeOwed: 0` because hosting is not playing, and on a FREE pool every member
  // does — all of them `paidStatus: 'UNPAID'` while owing nothing. A status-only
  // filter listed them here with a meaningless "Mark Paid" button and stopped the
  // card ever reaching its all-clear, on a card whose own tiles read Expected $0
  // and Outstanding Due $0.
  const rates = useMemo(() => duesRates(pool), [pool]);
  const unpaidRoster = useMemo(
    () => roster.filter(r => memberOutstanding(r, rates) > 0),
    [roster, rates],
  );

  // Unpaid members shown on the summary card (MAX 10)
  const dashboardUnpaidPlayers = useMemo(() => unpaidRoster.slice(0, 10), [unpaidRoster]);

  // The deadline the SERVER actually enforces for this week — and ONLY for pool
  // types that genuinely have one. It used to render a hardcoded sixteen-hour
  // countdown unconditionally, on every pool, whether or not the week held a
  // single game.
  //
  // Two codex rounds went into this, both on the FIX rather than the original
  // defect, and the second is why there is a type gate here at all:
  //
  //   r1 — the first version showed the first KICKOFF and called it the lock.
  //   Picks close `lockBufferMinutes` BEFORE kickoff (default 5; Survivor/Margin
  //   allow 5/30/60) and a hard-lock pool's deadline is frozen per week, so a
  //   kickoff label hands the commissioner a cutoff up to an hour late. Fixed by
  //   delegating to the same two helpers WeekChecklist uses — the surface MEMBERS
  //   read — so the two cannot state different deadlines.
  //
  //   r2 — a single week deadline is only TRUE for weekly-hard-lock pools. Default
  //   Pick'em is PER_GAME: `submitNFLPicksInternal` checks each picked game's own
  //   lock, so later games stay editable long after the first one closes, and
  //   `weekLockOverrides` can push an individual week's lock later still. That
  //   per-game/override model lives in `functions/src/lib/effectiveLock.ts`, which
  //   is not shared with the client, so there is no honest way to render one line
  //   for those pools from here. `usesWeeklyHardLock` (which IS shared) is the
  //   exact predicate the server uses to decide a pool has one week deadline, so
  //   the label renders for those pools and nothing at all for the rest.
  //   Showing nothing beats showing a deadline that is not enforced.
  const weekLockTime = useMemo(() => {
    if (!usesWeeklyHardLock(castPool.type)) return null;
    const buffer = effectiveBufferMinutesForWeek(castPool, week, weeklyGames.map(g => g.startTime));
    return weekDeadline(weeklyGames, buffer);
  }, [castPool, week, weeklyGames]);

  const handleNudge = async (player: { uid: string; name: string }) => {
    setIsNudging(player.uid);
    try {
      const { sent, skipped, skippedNoEmail, skippedRateLimited } = await dbService.sendManualReminder(pool.id, [player.uid], 'PICKS');
      // A zero-send is NOT a success. The backend now resolves targets from the
      // ROSTER, so a member who has never submitted IS reachable — that was the
      // whole point of the change. But zero-send is still possible (no email on
      // the user profile, or the uid is not on the roster at all), and it still
      // returns `sent: 0, skipped: 0` without erroring. An absent error is not
      // evidence that anything happened; this codebase has been bitten by that
      // three times (#314's unbound COURIER_AUTH_TOKEN, the zero-counter
      // reminder heartbeat, the 13-day Sentry outage). So the guard stays; only
      // the explanation changes, because the old one now names the wrong cause.
      if (sent > 0) {
        toast.success(`Reminder sent to ${player.name}.`);
      } else if (skippedNoEmail && skippedNoEmail > 0) {
        toast.error(`No reminder sent to ${player.name} — there is no email address on their account.`);
      } else if (skippedRateLimited && skippedRateLimited > 0) {
        toast.info(`${player.name} was reminded within the last 4 hours, so this one was not resent.`);
      } else if (skipped > 0) {
        // An older deployed function returns `skipped` with no breakdown. Say
        // what is known and no more — naming one cause here would be a guess.
        toast.info(`No reminder sent to ${player.name}. Either they were reminded recently or they have no email on file.`);
      } else {
        toast.error(`No reminder could be sent to ${player.name} — they were not found on this pool's roster.`);
      }
    } catch (err) {
      console.error('Failed to send pick reminder:', err);
      toast.error(getUserMessage(err));
    } finally {
      setIsNudging(null);
    }
  };

  /** Post the commissioner's OWN words, verbatim, under their name. No AI. */
  const handlePostBanter = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = banterText.trim();
    if (!text || banterBusy) return;
    if (!_user?.id) { toast.error('Sign in to post to your pool.'); return; }
    setBanterBusy('post');
    try {
      await dbService.sendBanterMessage(pool.id, {
        authorUid: _user.id,
        authorName: _user.name || 'Commissioner',
        text,
        kind: 'COMMISSIONER',
        timestamp: Date.now(),
      });
      setBanterText('');
    } catch (err) {
      toast.error(getUserMessage(err));
    } finally {
      setBanterBusy(null);
    }
  };

  /**
   * Ask the AI to write the post. This goes through the REAL pipeline —
   * `ai_requests` → `onAIRequest` → Gemini → the same feed — not a local
   * string. The result arrives through the subscription above, so there is
   * nothing to await here beyond the request landing.
   */
  const handleAskAI = async () => {
    const prompt = banterText.trim();
    if (!prompt || banterBusy) return;
    if (!_user?.id) { toast.error('Sign in to post to your pool.'); return; }
    setBanterBusy('ai');
    try {
      await dbService.requestAIBanter(pool.id, _user.id, prompt, aiMood);
      setBanterText('');
      toast.success('Asked the AI Commissioner — the post appears in the feed in a few seconds.');
    } catch (err) {
      toast.error(getUserMessage(err));
    } finally {
      setBanterBusy(null);
    }
  };

  /**
   * Pin / unpin, from the same card the commissioner posts and deletes from.
   *
   * ⚠️ WRITTEN THROUGH `updatePoolSettings`, NOT a direct `updateDoc`. The pool
   * document's client update rule carries `poolIsEditable()`, which allows a
   * manager write only while the pool is DRAFT or OPEN — so a direct write would
   * fail exactly when pinning is wanted, in the middle of a locked season. The
   * callable applies `shared/editability.ts` instead, where `announcement` is
   * editable in every phase.
   *
   * `messageId` is '' to unpin. One field means one pinned post: pinning a
   * second necessarily unpins the first, with nothing to enforce.
   */
  const handleTogglePin = async (messageId: string) => {
    // While unpinning, the row being acted on is the CURRENTLY pinned one — its
    // id, not the empty string, is what has to show a busy state.
    setPinningId(messageId || pinnedMessageId || null);
    try {
      await dbService.updatePoolSettings(pool.id, { pinnedMessageId: messageId });
      toast.success(messageId
        ? 'Pinned to the top of your pool home page.'
        : 'Unpinned. Nothing sits at the top of the pool home page now.');
    } catch (err) {
      toast.error(getUserMessage(err));
    } finally {
      setPinningId(null);
    }
  };

  const handleDeleteBanter = async (messageId: string) => {
    setDeletingMessageId(messageId);
    try {
      await dbService.deletePoolMessage(pool.id, messageId);
    } catch (err) {
      toast.error(getUserMessage(err));
    } finally {
      setDeletingMessageId(null);
    }
  };

  // Submission Health PieChart Data (Recharts)
  const submissionPieData = useMemo(() => {
    return [
      { name: 'Submitted', value: submissionStats.submitted, color: '#B78F4A' },
      { name: 'Pending', value: submissionStats.pendingCount, color: '#142A4C' }
    ];
  }, [submissionStats]);

  // Financial Revenue BarChart Data (Recharts)
  const financialBarData = useMemo(() => {
    return [
      {
        name: 'Collected',
        Amount: pot.collected,
        fill: '#0F7B4A'
      },
      {
        name: 'Outstanding',
        Amount: outstandingDue(pot),
        fill: '#C9A867'
      }
    ];
  }, [pot]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">

      {/* CARD 1: POOL PERFORMANCE & SUBMISSIONS HEALTH */}
      <div
        className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Submission Health</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">{nflWeekLabel(poolSeasonType(pool), week)} Pick Completion Rate</p>
            </div>
            <Badge status="live" className="text-[10px]">
              Live Tracker
            </Badge>
          </div>

          <div className="flex items-center gap-8 mb-6">
            {/* Recharts PieChart replaces raw SVG progress ring */}
            <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={submissionPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={36}
                    outerRadius={48}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {submissionPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                <span className="font-display font-bold text-lg text-[color:var(--text)] leading-none num">{submissionStats.percentage}%</span>
                <span className="font-display font-bold text-[7px] text-faint uppercase tracking-[0.16em] mt-0.5">Active</span>
              </div>
            </div>

            <div>
              <h4 className="font-display font-bold text-sm text-[color:var(--text)] uppercase mb-1">Weekly Summary</h4>
              <p className="font-body text-xs text-muted leading-relaxed mb-2">
                <strong className="num">{submissionStats.submitted}</strong> of <strong className="num">{submissionStats.total}</strong> active participants have successfully locked-in their selections.
              </p>
              {weekLockTime !== null && (
                <span className="font-display font-bold text-[10px] text-gold-600 dark:text-gold-400 uppercase tracking-[0.08em] flex items-center gap-1.5">
                  <AlertCircle size={12} /> {nflWeekLabel(poolSeasonType(pool), week)} picks lock {formatDeadline(weekLockTime)}
                </span>
              )}
            </div>
          </div>

          {/* List of slackers who need nudging */}
          <div className="space-y-3">
            <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-1">Pending Pick Sheets (<span className="num">{unsubmittedPlayers.length}</span>)</span>
            {unsubmittedPlayers.length > 0 ? (
              unsubmittedPlayers.slice(0, 5).map((player, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 rounded-lg border bg-page border-line transition-all duration-150 hover:bg-surface">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-navy-800 font-display font-bold text-xs text-white flex items-center justify-center uppercase">
                      {player.name.substring(0,2).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-display font-bold text-xs text-[color:var(--text)] block uppercase leading-none">{player.name}</span>
                      {/* This used to render a hardcoded placeholder address for
                          every member with none on file — a fabricated contact
                          detail shown as if it were real, on the list a
                          commissioner uses to chase people for picks.
                          codex r2: the first replacement said "No email
                          registered", which asserts a fact this client cannot
                          know. `email` on a roster row comes only from the ENTRY
                          document; Member Records carry none, and the reminder
                          backend resolves `users/{uid}.email` server-side. So a
                          perfectly registered member who simply has no entry yet
                          — exactly the rows this card newly surfaces — would be
                          labelled unregistered. Say what is true of THIS view. */}
                      <span className="font-body font-semibold text-[9px] text-faint">{player.email || 'Email not shown here'}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleNudge(player)}
                    // A row present ONLY in participantIds has neither a Member
                    // Record nor an entry, and the resolver deliberately rejects
                    // that uid (participantIds is client-writable). Enabling the
                    // button there guarantees a 0/0 response reported as "not on
                    // this roster" — re-creating the dead button #329 removed.
                    disabled={isNudging !== null || (!player.hasMember && !player.hasEntry)}
                    title={!player.hasMember && !player.hasEntry
                      ? 'This member is on the roster list only, with no member record or entry, so there is nothing to remind against yet.'
                      : player.hasEntry
                        ? undefined
                        : 'This member has not started an entry — nudging them is exactly the point.'}
                    className="min-h-[44px] bg-gold-400/10 border border-gold-500/40 hover:bg-gold-400/20 text-gold-600 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.05em] px-3.5 rounded-md transition-all duration-150 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {/* The label still distinguishes the two states — a
                        commissioner wants to know who has not started — but the
                        button is no longer disabled for them, because the
                        backend can now reach a member with no entry. */}
                    {isNudging === player.uid ? 'Sending...' : player.hasEntry ? 'Nudge Email' : 'Nudge — Not Started'}
                  </button>
                </div>
              ))
            ) : (
              <div className="text-gold-700 dark:text-gold-400 font-display font-bold text-xs uppercase text-center py-4 bg-gold-400/10 border border-gold-500/40 rounded-lg flex items-center justify-center gap-2">
                <PartyPopper size={14} /> Perfect submission health! Everyone has completed their pick sheets.
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em] flex items-center gap-1">
            <Activity size={12} className="text-faint" /> Auto-reminders enabled
          </span>
          <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.08em]">
            Platform healthy
          </span>
        </div>
      </div>

      {/* CARD 2: BUY-IN REVENUE LEDGER & MEMBERS ACCREDITATION */}
      <div
        className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Buy-ins at a glance</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Full detail in the Payment Ledger</p>
            </div>
            <button
              onClick={onOpenLedger}
              className="bg-navy-800 hover:bg-navy-700 transition-all duration-150 hover:-translate-y-px text-white font-display font-bold text-[10px] uppercase tracking-[0.05em] px-3.5 py-1.5 rounded-md shadow-card"
            >
              Open Payment Ledger
            </button>
          </div>

          {/* Recharts BarChart represents Collected vs Outstanding side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="md:col-span-2 bg-page border border-line p-3 rounded-lg h-24">
              <ResponsiveContainer width="100%" height="100%">
                {/* A NEGATIVE left margin dragged the category labels off the left
                    edge — "Collected"/"Outstanding" were clipped away entirely on a
                    layout="vertical" chart, where the Y axis IS the label column.
                    The margin must leave room for the widest tick, and the axis
                    needs an explicit width or recharts falls back to its 60px
                    default and re-crops the same labels. */}
                <BarChart data={financialBarData} layout="vertical" margin={{ top: 2, right: 12, left: 4, bottom: 2 }}>
                  <XAxis type="number" stroke="#24507F" fontSize={8} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="name" stroke="#24507F" fontSize={8} width={68} />
                  <Tooltip cursor={{ fill: 'rgba(19,27,43,0.04)' }} contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)', color: 'var(--text)', borderRadius: '10px', fontSize: '9px' }} />
                  <Bar dataKey="Amount" radius={[0, 4, 4, 0]}>
                    {financialBarData.map((d, index) => (
                      <Cell key={`cell-${index}`} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-page border border-line p-3.5 rounded-lg text-center flex flex-col justify-center">
              <span className="font-display font-bold uppercase text-[9px] tracking-[0.08em] text-faint block mb-0.5">Projected Pot</span>
              <span className="font-display font-bold text-xl text-gold-600 dark:text-gold-400 num">${pot.expected}</span>
            </div>
          </div>

          {/* Members list limited to 10 UNPAID players */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-1">Members Still Owing (<span className="num">{unpaidRoster.length}</span>)</span>
              <span className="font-display font-bold text-[8px] text-faint uppercase tracking-[0.08em]">Showing Max 10</span>
            </div>

            {dashboardUnpaidPlayers.length > 0 ? (
              dashboardUnpaidPlayers.map((player) => {
                // Base dues PAID but still on this list means the debt is REBUY
                // dues, which settle independently (P3). "Mark Paid" would toggle
                // them to UNPAID — the opposite of what a commissioner clicking it
                // wants — and rebuy settlement is a different callable mode
                // (settleRebuys) that lives on the Payment Ledger. So the row
                // names the debt and offers no misleading action.
                //
                // This branch is why codex r1's separate "base cleared, rebuy
                // outstanding" empty state is gone: once the list is filtered by
                // DEBT rather than paid status (codex r5), rebuy-only debtors
                // appear IN the list, and that empty state became unreachable. A
                // branch that cannot be reached is not a safeguard.
                const owes = memberOutstanding(player, rates);
                const baseDuesPaid = player.paidStatus === 'PAID';
                return (
                  <div
                    key={player.uid}
                    className="flex justify-between items-center p-3 rounded-lg border border-line bg-page hover:bg-surface transition-all duration-150"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md font-display font-bold text-xs flex items-center justify-center bg-navy-800 text-white">
                        {player.displayName.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-display font-bold text-xs text-[color:var(--text)] block uppercase leading-none mb-1">
                          {player.displayName}
                        </span>
                        <span className="font-body font-semibold text-[9px] text-faint">
                          {player.email || 'Email not shown here'} · <span className="num">${owes}</span> due
                        </span>
                      </div>
                    </div>

                    {baseDuesPaid ? (
                      <span className="font-display font-bold text-[9px] uppercase tracking-[0.08em] text-gold-700 dark:text-gold-400 bg-gold-400/10 border border-gold-500/40 px-2.5 py-1.5 rounded-md text-center leading-tight">
                        Rebuy dues<br />settle in the ledger
                      </span>
                    ) : (
                      <button
                        onClick={() => togglePayment(player.uid, false, player.hasMember)}
                        disabled={togglingId === player.uid}
                        className="flex items-center gap-2 bg-navy-800 hover:bg-navy-700 text-white px-3.5 py-1.5 rounded-md text-[10px] font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 hover:-translate-y-px"
                      >
                        {togglingId === player.uid ? 'Saving...' : 'Mark Paid'}
                      </button>
                    )}
                  </div>
                );
              })
            ) : pot.memberCount === 0 ? (
              // An empty roster is NOT "all buy-ins cleared" — the old card showed
              // the green all-clear on a pool nobody had joined.
              <div className="text-muted font-display font-bold text-xs uppercase text-center py-6 bg-page border border-line rounded-lg">
                No members have joined yet.
              </div>
            ) : (
              <div className="text-[#0F7B4A] font-display font-bold text-xs uppercase text-center py-6 bg-[#E4F5EC] border border-[#BEE7D0] rounded-lg flex flex-col items-center gap-1">
                <CheckCircle size={24} />
                <span>All buy-ins cleared! Excellent ledger status.</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Commission status</span>
          <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.08em]">
            100% Secure Transaction Logs
          </span>
        </div>
      </div>

      {/* CARD 3: COMMISSIONER AI BANTER WIDGET */}
      <div
        className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Pool Feed &amp; AI Commissioner</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Everyone in your pool sees this</p>
            </div>
            <Volume2 size={18} className="text-gold-600 dark:text-gold-400" />
          </div>

          {/* T9 - the card explains itself. It used to be three unlabelled mood
              buttons and one box, under a footer that admitted the whole thing
              was a local draft nothing kept: a commissioner had no way to know
              what any of it did, and in fact it did nothing. */}
          <p className="mb-4 font-body text-xs text-muted leading-relaxed">
            Write a note to your pool, or describe what you want and let the AI Commissioner write it.
            Posts appear on every member&rsquo;s pool page. You can delete any post, including the AI&rsquo;s.
          </p>

          {/* Mood - only affects what the AI writes, so say that. */}
          <p className="mb-2 font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint">
            AI tone
          </p>
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            {[
              { id: 'savage', label: 'Savage', desc: 'Jokes & roasts' },
              { id: 'professional', label: 'Pro', desc: 'Firm & direct' },
              { id: 'analyst', label: 'Analyst', desc: 'Data & stats' }
            ].map(mood => (
              <button
                key={mood.id}
                type="button"
                aria-pressed={aiMood === mood.id}
                onClick={() => setAiMood(mood.id as 'savage' | 'professional' | 'analyst')}
                className={`text-left p-3.5 rounded-lg border transition-all duration-150 ${
                  aiMood === mood.id
                    ? 'bg-card border-gold-500 shadow-card scale-[1.02]'
                    : 'bg-page border-line opacity-60 hover:opacity-100'
                }`}
              >
                <span className="font-display font-bold text-xs text-[color:var(--text)] uppercase block leading-none mb-1">{mood.label}</span>
                <span className="font-display font-bold text-[8px] text-faint uppercase tracking-[0.16em] leading-none">{mood.desc}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handlePostBanter} className="mb-4">
            <input
              type="text"
              aria-label="Message or AI prompt"
              placeholder="Type your own message, or describe what the AI should write..."
              value={banterText}
              onChange={e => setBanterText(e.target.value)}
              maxLength={500}
              className="w-full bg-page border border-line rounded-md px-4 py-3 font-body text-xs text-[color:var(--text)] placeholder:text-faint focus:ring-1 focus:ring-navy-600 dark:focus:ring-gold-500 focus:outline-none"
            />
            <div className="flex gap-2 mt-2">
              {/* Two BUTTONS, not one, because they do different things and the
                  old single Send button hid that entirely. */}
              <button
                type="submit"
                disabled={!banterText.trim() || banterBusy !== null}
                className="flex items-center justify-center gap-1.5 bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2.5 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={13} aria-hidden="true" /> {banterBusy === 'post' ? 'Posting...' : 'Post as me'}
              </button>
              <button
                type="button"
                onClick={handleAskAI}
                disabled={!banterText.trim() || banterBusy !== null || !aiUnlocked}
                title={aiUnlocked ? 'The AI writes the post in the selected tone' : 'AI Commissioner is not unlocked on this pool'}
                className="flex items-center justify-center gap-1.5 border border-gold-500/60 text-gold-700 dark:text-gold-300 px-4 py-2.5 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] transition-all duration-150 hover:bg-gold-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles size={13} aria-hidden="true" /> {banterBusy === 'ai' ? 'Asking...' : 'Let AI write it'}
              </button>
            </div>
            {lastBanterRequest?.status === 'ERROR' && (
              <p className="mt-2 font-body text-[11px] text-brandred-600" role="alert">
                {lastBanterRequest.error === 'BANTER_NOT_COMMISSIONER'
                  ? 'Only a commissioner of this pool can have the AI post to the feed.'
                  : 'The AI could not write that one. Nothing was posted — try again, or post it yourself.'}
              </p>
            )}
            {lastBanterRequest?.status === 'GENERATING' && (
              <p className="mt-2 font-body text-[11px] text-muted">The AI Commissioner is writing…</p>
            )}
            {!aiUnlocked && (
              /* Honest, and specific: T5 makes a TRIAL unlock the add-ons the
                 wizard selected, so this now means "not selected / not bought",
                 not "wait until you pay". */
              <p className="mt-2 font-body text-[11px] text-muted">
                AI Commissioner is not switched on for this pool - your own posts still work.
              </p>
            )}
          </form>

          <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-2">Pool feed</span>
          <BanterFeed
            messages={banterFeed}
            error={feedError}
            canDelete
            onDelete={handleDeleteBanter}
            deletingId={deletingMessageId}
            canPin
            pinnedId={pinnedMessageId}
            onTogglePin={handleTogglePin}
            pinningId={pinningId}
            emptyText="Nothing posted yet. Anything you post here appears on every member's pool page."
            maxHeightClass="max-h-56"
          />
          <p className="mt-2 font-body text-[11px] text-muted">
            Pin one post to put it at the top of the pool home page, right under the score ticker. Pinning another moves it; the pin button unpins.
          </p>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Pool feed</span>
          {/* This used to admit the card kept nothing — the honest label of an
              unbuilt feature: nothing was persisted and no member ever saw it
              (HANDOFF item 8). T9 built it, so the label states what is true
              now. Paraphrased on purpose: tests/ai-commissioner-feed.test.ts
              asserts the old string is absent from this FILE, comments
              included, so quoting it back would fail the guard on the
              explanation of its own fix. */}
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">
            {banterFeed.length === 0 ? 'Visible to all members' : `${banterFeed.length} post${banterFeed.length === 1 ? '' : 's'} - visible to all members`}
          </span>
        </div>
      </div>

      {/* CARD 4 IS GONE — it was "Commissioner Actions" and every part of it was
          fabricated:

            * "Recalculate Scores" popped a toast announcing that an ESPN score
              recalculation had begun, and called NOTHING. The real control is
              "Score & Recap Week N" further down this same page. A commissioner
              who clicked the decoy before the Hall of Fame game would have been
              told the scores were recalculating when nothing had happened.
            * "Toggle Locks" popped a toast announcing a lock change and called
              nothing. There is no client lock toggle; locks are time-derived.
            * The "League operations log" invented its own history: hardcoded
              relative timestamps attached to a standings finalization and an
              ESPN schedule sync, neither of which had ever run on the pool.

          The genuine equivalent already exists and is already reachable: the
          Payments tab renders the append-only payment ledger
          (pools/{id}/payments) with real timestamps, for the commissioner too.
          A second copy here would be a duplicate reader, so this card is
          removed rather than rebuilt. */}

    </div>
  );
};
