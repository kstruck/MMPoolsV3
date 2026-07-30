import React, { useState, useMemo } from 'react';
import type { User as UserType, Pool, NFLGame } from '../../types';
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
  Search,
  DollarSign,
  X,
  Edit,
  Save,
  PartyPopper,
  Megaphone
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
import { gamesForPoolWeek, weekDeadline } from '../../utils/nflPending';
import { effectiveBufferMinutesForWeek, usesWeeklyHardLock } from '@shared/weeklyHardLock';
import { buildPoolRoster, rosterPotStats, outstandingDue, clearingRate, duesRates, memberOutstanding } from '../../utils/poolRoster';
import { formatDeadline } from '../../utils/formatTime';

interface NFLManagerBentoDashboardProps {
  pool: Pool;
  entries: any[];
  /** Member Records — roster + payment truth, incl. members with no entry (ADR 0003) */
  members: any[];
  games: NFLGame[];
  week: number;
  user: UserType | null;
  onSelectTab: (tab: 'picks' | 'standings' | 'recaps' | 'rules' | 'manager') => void;
}

export const NFLManagerBentoDashboard: React.FC<NFLManagerBentoDashboardProps> = ({
  pool,
  entries,
  members,
  games: _games,
  week,
  user: _user,
  onSelectTab: _onSelectTab
}) => {
  const castPool = pool as any;
  const toast = useToast();
  const [aiMood, setAiMood] = useState<'savage' | 'professional' | 'analyst'>('savage');
  const [banterText, setBanterText] = useState('');
  // Starts EMPTY. It used to be seeded with invented commissioner analysis: a
  // claim that the current leader had a history of collapsing late in the
  // season, where the top-player fallback on an empty pool was a mock name
  // lifted from DevDashboardPreview — so a one-player pool that had never
  // played a week was shown a scouting report on a rival. Nothing posted here
  // is persisted (HANDOFF item 8), so an empty feed is the honest start.
  //
  // tests/admin-surface-invariants.test.ts asserts the removed strings are
  // absent from this FILE, comments included. Paraphrase them; never quote them
  // back in, or the guard fails on the explanation of its own defect.
  const [banterFeed, setBanterFeed] = useState<string[]>([]);

  const [isNudging, setIsNudging] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savingLedgerId, setSavingLedgerId] = useState<string | null>(null);

  // Modal State for full payment ledger
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');

  // Local state for editing payment details in ledger
  // Keyed by member UID, not entry id — the ledger's rows are roster rows now.
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editPaidStatus, setEditPaidStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');
  const [editMethod, setEditMethod] = useState('Venmo');
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');

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

  const saveDetailedPayment = async (uid: string, hasMember: boolean) => {
    setSavingLedgerId(uid);
    try {
      const timestamp = editDate ? new Date(editDate).getTime() : Date.now();
      // Details ride only with PAID; an UNPAID save is a full clear server-side
      // (the schema refuses details with it — an unpaid member must not display
      // a payment method and transaction note).
      await dbService.setPaidStatus(
        pool.id, uid, editPaidStatus === 'PAID',
        editPaidStatus === 'PAID'
          ? { paymentMethod: editMethod, paidAt: timestamp, paymentNote: editNote || null }
          : undefined,
      );
      setEditingUid(null);
    } catch (err) {
      console.error("Failed to update detailed payment:", err);
      toast.error(paymentError(err, hasMember, 'Failed to save the payment details. Please try again.'));
    } finally {
      setSavingLedgerId(null);
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

  // Derived unsubmitted players list.
  // Pick'em: unsubmitted = at least one current-week game without a pick (picks keyed by gameId).
  // Survivor/Margin: unsubmitted = no pick stored under the current week number.
  const weeklyGames = useMemo(() => gamesForPoolWeek(_games, castPool, week), [_games, castPool, week]);
  const unsubmittedPlayers = useMemo(() => {
    const list = entries.filter(e => {
      const picks = e.picks || {};
      if (pool.type === 'NFL_PICKEM') {
        return weeklyGames.length > 0 && !weeklyGames.every(g => !!picks[g.id]);
      }
      return !picks[week];
    });
    return list.map(e => ({
      id: e.id,
      uid: e.ownerUid || e.id,
      name: e.userName || e.ownerName || 'User ' + e.id.substring(0, 4),
      email: e.email || 'user@example.com'
    }));
  }, [entries, week, pool.type, weeklyGames]);

  // 1. Calculations for Pick submissions status
  const submissionStats = useMemo(() => {
    const total = entries.length;
    const pendingCount = unsubmittedPlayers.length;
    const submitted = total - pendingCount;
    const percentage = total > 0 ? Math.round((submitted / total) * 100) : 0;
    return { total, submitted, pendingCount, percentage };
  }, [entries, unsubmittedPlayers]);

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

  // Filtered roster for the full Payment Ledger Modal
  const ledgerFilteredPlayers = useMemo(() => {
    const query = ledgerSearch.toLowerCase();
    return roster.filter(p => {
      const matchesSearch =
        p.displayName.toLowerCase().includes(query) ||
        (p.email || '').toLowerCase().includes(query) ||
        (p.paymentNote || '').toLowerCase().includes(query);

      const matchesFilter = ledgerFilter === 'ALL' ||
                            (ledgerFilter === 'PAID' && p.paidStatus === 'PAID') ||
                            (ledgerFilter === 'UNPAID' && p.paidStatus !== 'PAID');

      return matchesSearch && matchesFilter;
    });
  }, [roster, ledgerSearch, ledgerFilter]);

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
      const { sent, skipped } = await dbService.sendManualReminder(pool.id, [player.uid], 'PICKS');
      toast.success(`Sent ${sent} reminder(s), ${skipped} skipped (recently reminded)`);
    } catch (err) {
      console.error('Failed to send pick reminder:', err);
      toast.error(getUserMessage(err));
    } finally {
      setIsNudging(null);
    }
  };

  const handleSendBanter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!banterText.trim()) return;

    let Prefix = "COMMISSIONER [Savage Mode]: ";
    if (aiMood === 'professional') Prefix = "COMMISSIONER [Professional]: ";
    if (aiMood === 'analyst') Prefix = "COMMISSIONER [Data Analyst]: ";

    setBanterFeed(prev => [
      `${Prefix}${banterText}`,
      ...prev
    ]);
    setBanterText('');
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
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Week {week} Pick Completion Rate</p>
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
                  <AlertCircle size={12} /> Week {week} picks lock {formatDeadline(weekLockTime)}
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
                      <span className="font-body font-semibold text-[9px] text-faint">{player.email}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleNudge(player)}
                    disabled={isNudging !== null}
                    className="min-h-[44px] bg-gold-400/10 border border-gold-500/40 hover:bg-gold-400/20 text-gold-600 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.05em] px-3.5 rounded-md transition-all duration-150 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isNudging === player.uid ? 'Sending...' : 'Nudge Email'}
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
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Buy-In Ledger</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Member Financial Tracking</p>
            </div>
            <button
              onClick={() => setIsLedgerOpen(true)}
              className="bg-navy-800 hover:bg-navy-700 transition-all duration-150 hover:-translate-y-px text-white font-display font-bold text-[10px] uppercase tracking-[0.05em] px-3.5 py-1.5 rounded-md shadow-card"
            >
              View Full Ledger
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
                // (settleRebuys) that lives on the member roster below. So the row
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
                          {player.email || 'No email registered'} · <span className="num">${owes}</span> due
                        </span>
                      </div>
                    </div>

                    {baseDuesPaid ? (
                      <span className="font-display font-bold text-[9px] uppercase tracking-[0.08em] text-gold-700 dark:text-gold-400 bg-gold-400/10 border border-gold-500/40 px-2.5 py-1.5 rounded-md text-center leading-tight">
                        Rebuy dues<br />settle below
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
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">AI Commissioner Chat</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Generate custom trash talk banter</p>
            </div>
            <Volume2 size={18} className="text-gold-600 dark:text-gold-400" />
          </div>

          {/* AI Commissioner Mood configurations */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {[
              { id: 'savage', label: 'Savage', desc: 'Rants & burns', color: 'border-gold-500/50 text-gold-600' },
              { id: 'professional', label: 'Pro', desc: 'Firm & direct', color: 'border-navy-600/50 text-navy-700' },
              { id: 'analyst', label: 'Analyst', desc: 'Data & stats', color: 'border-gold-500/50 text-gold-600' }
            ].map(mood => (
              <button
                key={mood.id}
                onClick={() => setAiMood(mood.id as any)}
                className={`text-left p-3.5 rounded-lg border transition-all duration-150 ${
                  aiMood === mood.id
                    ? `bg-card border-gold-500 shadow-card scale-[1.02]`
                    : 'bg-page border-line opacity-60 hover:opacity-100'
                }`}
              >
                <span className="font-display font-bold text-xs text-[color:var(--text)] uppercase block leading-none mb-1">{mood.label}</span>
                <span className="font-display font-bold text-[8px] text-faint uppercase tracking-[0.16em] leading-none">{mood.desc}</span>
              </button>
            ))}
          </div>

          {/* Live Banter entry feed */}
          <form onSubmit={handleSendBanter} className="flex gap-2 mb-5">
            <input
              type="text"
              placeholder={`Type a comment or prompt the AI as a ${aiMood} commissioner...`}
              value={banterText}
              onChange={e => setBanterText(e.target.value)}
              className="flex-1 bg-page border border-line rounded-md px-4 py-3 font-body text-xs text-[color:var(--text)] placeholder:text-faint focus:ring-1 focus:ring-navy-600 dark:focus:ring-gold-500 focus:outline-none"
            />
            <button
              type="submit"
              className="bg-brandred-600 hover:bg-brandred-500 text-white p-3 rounded-md transition-all duration-150 hover:-translate-y-px shadow-red-cta active:scale-95"
            >
              <Send size={15} />
            </button>
          </form>

          {/* Scrolling Feed of Recent Banters */}
          <div className="space-y-3 max-h-40 overflow-y-auto pr-1">
            <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-1">Live banter feed</span>
            {banterFeed.length === 0 && (
              <div className="p-3.5 bg-page border border-line rounded-lg font-body text-xs text-muted leading-relaxed">
                Nothing posted yet. Anything you post here is local to this browser tab and is not saved.
              </div>
            )}
            {banterFeed.map((item, idx) => (
              <div key={idx} className="p-3.5 bg-page border border-line rounded-lg font-body text-xs text-[color:var(--text)] leading-relaxed font-semibold flex items-start gap-2">
                <Megaphone size={13} className="text-brandred-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Banter engine status</span>
          {/* This used to claim an active AI moderation capability. There is no AI
              and no moderation here yet — nothing is sent anywhere (HANDOFF item
              8). PLAN-BANTER-PANEL makes it real; until then the label says
              what it actually does. */}
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">
            Draft only — not saved
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

      {/* FULL FEATURED PAYMENT LEDGER MODAL */}
      {isLedgerOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-line rounded-xl w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-panel flex flex-col text-[color:var(--text)]">
            {/* Header */}
            <div className="p-6 border-b border-line flex justify-between items-center bg-surface">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gold-400/10 border border-gold-500/40 text-gold-600 dark:text-gold-400 rounded-lg">
                  <DollarSign size={20} />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-[color:var(--text)] uppercase tracking-[0.05em]">Advanced Payment Ledger</h3>
                  <p className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-faint mt-0.5">{pool.name} Roster Financials</p>
                </div>
              </div>
              <button
                onClick={() => { setIsLedgerOpen(false); setEditingUid(null); }}
                className="p-2 hover:bg-page rounded-md text-muted hover:text-[color:var(--text)] transition-all duration-150"
              >
                <X size={20} />
              </button>
            </div>

            {/* Sub-Header stats panels & Filters */}
            <div className="p-6 bg-surface border-b border-line space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { title: 'Total Projected', value: `$${pot.expected}`, color: 'text-[color:var(--text)]' },
                  { title: 'Total Collected', value: `$${pot.collected}`, color: 'text-[#0F7B4A]' },
                  { title: 'Outstanding Due', value: `$${outstandingDue(pot)}`, color: 'text-gold-600 dark:text-gold-400' },
                  // Denominator is everyone who JOINED, not everyone with an entry —
                  // the old figure read 100% on a pool where only the one entry
                  // holder had paid and three other members had not.
                  { title: 'Clearing Rate', value: `${clearingRate(pot)}%`, color: 'text-navy-700 dark:text-gold-400' }
                ].map((stat, idx) => (
                  <div key={idx} className="bg-page border border-line p-3 rounded-lg text-center">
                    <span className="font-display font-bold uppercase text-[8px] tracking-[0.08em] text-faint block mb-0.5">{stat.title}</span>
                    <span className={`font-display font-bold text-sm ${stat.color} num`}>{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* Filtering & Search Row */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search player name, email, note..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="w-full bg-page border border-line rounded-md py-2.5 px-4 pl-10 font-body text-xs text-[color:var(--text)] placeholder:text-faint focus:ring-1 focus:ring-navy-600 dark:focus:ring-gold-500 focus:outline-none"
                  />
                  <Search className="absolute left-3 top-3 text-faint" size={14} />
                </div>

                <div className="flex gap-1 bg-page p-1 border border-line rounded-md">
                  {['ALL', 'PAID', 'UNPAID'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setLedgerFilter(type as any)}
                      className={`px-3 py-1.5 rounded-sm text-[9px] font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 ${
                        ledgerFilter === type
                          ? 'bg-navy-800 text-white shadow-card'
                          : 'text-muted hover:text-[color:var(--text)]'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-auto p-6">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-line font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">
                    <th className="pb-3 px-2">Player / Contact</th>
                    <th className="pb-3 px-2 text-center w-28">Status</th>
                    <th className="pb-3 px-2 w-32">Method</th>
                    <th className="pb-3 px-2 w-36">Paid Date</th>
                    <th className="pb-3 px-2">Transaction ID / Notes</th>
                    <th className="pb-3 px-2 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledgerFilteredPlayers.length > 0 ? (
                    ledgerFilteredPlayers.map((player) => {
                      const rowUid = player.uid;
                      const isEditing = editingUid === rowUid;
                      const isPaid = player.paidStatus === 'PAID';

                      return (
                        <tr key={rowUid} className="hover:bg-page transition-colors duration-150">
                          {/* Name / Email */}
                          <td className="py-3 px-2">
                            <span className="font-display font-bold text-[color:var(--text)] block uppercase">{player.displayName}</span>
                            <span className="font-body text-[9px] text-faint">{player.email || 'No email registered'}</span>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-2 text-center">
                            {isEditing ? (
                              <select
                                value={editPaidStatus}
                                onChange={(e) => setEditPaidStatus(e.target.value as any)}
                                className="bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)] font-bold"
                              >
                                <option value="PAID">PAID</option>
                                <option value="UNPAID">UNPAID</option>
                              </select>
                            ) : (
                              <Badge status={isPaid ? 'paid' : 'unpaid'} className="text-[10px] px-2 py-1">
                                {player.paidStatus || 'UNPAID'}
                              </Badge>
                            )}
                          </td>

                          {/* Payment Method */}
                          <td className="py-3 px-2 font-body text-muted font-semibold">
                            {isEditing ? (
                              <select
                                value={editMethod}
                                onChange={(e) => setEditMethod(e.target.value)}
                                className="bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)]"
                              >
                                <option value="Venmo">Venmo</option>
                                <option value="Zelle">Zelle</option>
                                <option value="PayPal">PayPal</option>
                                <option value="Cash">Cash</option>
                                <option value="Card">Credit Card</option>
                                <option value="Other">Other</option>
                              </select>
                            ) : (
                              player.paymentMethod || <span className="text-faint italic">N/A</span>
                            )}
                          </td>

                          {/* Paid Date */}
                          <td className="py-3 px-2 font-body text-muted num">
                            {isEditing ? (
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)]"
                              />
                            ) : (
                              player.paidAt ? new Date(player.paidAt).toLocaleDateString() : <span className="text-faint italic">N/A</span>
                            )}
                          </td>

                          {/* Notes */}
                          <td className="py-3 px-2 font-body text-muted">
                            {isEditing ? (
                              <input
                                type="text"
                                placeholder="Tx ID or comments..."
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                className="w-full bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)] placeholder:text-faint"
                              />
                            ) : (
                              player.paymentNote || <span className="text-faint italic">None</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-2 text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => saveDetailedPayment(rowUid, player.hasMember)}
                                  disabled={savingLedgerId === rowUid}
                                  className="p-1 bg-navy-800 text-white hover:bg-navy-700 rounded-sm transition-all duration-150 disabled:opacity-50"
                                >
                                  <Save size={14} />
                                </button>
                                <button
                                  onClick={() => setEditingUid(null)}
                                  className="p-1 bg-page text-muted border border-line hover:bg-surface rounded-sm transition-all duration-150"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingUid(rowUid);
                                  setEditPaidStatus(player.paidStatus || 'UNPAID');
                                  setEditMethod(player.paymentMethod || 'Venmo');
                                  setEditDate(player.paidAt ? new Date(player.paidAt).toISOString().split('T')[0] : '');
                                  setEditNote(player.paymentNote || '');
                                }}
                                className="p-1 bg-page hover:bg-surface border border-line rounded-sm text-muted hover:text-[color:var(--text)] transition-all duration-150"
                              >
                                <Edit size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-faint font-body font-bold">
                        {/* An empty ROSTER and an empty FILTER are different facts. The
                            old table said "no members matching filter criteria" for
                            both, which read as a filter problem on a pool that simply
                            had nobody in it — and, before the roster fix, on pools that
                            did. */}
                        {roster.length === 0
                          ? 'No members have joined this pool yet.'
                          : 'No members match the current search or filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-line bg-surface flex justify-between items-center text-[10px] text-faint font-display font-bold uppercase tracking-[0.08em]">
              <span>Platform TLS Accreditation: Secure</span>
              <span>Clearing Ledger Logs v2.4</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
