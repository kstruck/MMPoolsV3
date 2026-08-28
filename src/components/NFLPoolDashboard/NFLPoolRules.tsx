import React from 'react';
import { effectiveWeeklyTiebreaker } from '@shared/nflTiebreaker';
import { HelpCircle, Shield, Award, Calendar, DollarSign, RefreshCw, Zap, Trophy, Lock, Settings } from 'lucide-react';
import type { Pool } from '../../types';
import { PayoutsPanel } from '../PayoutsPanel';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType } from '../../utils/nflPending';
import { survivorRuleCopy, survivorRebuyRuleCopy } from '../../utils/survivorRules';
import { effectiveMaxTeamUses, UNLIMITED_TEAM_USES } from '@shared/survivorReuse';

interface NFLPoolRulesProps {
  pool: Pool;
  isManager?: boolean;
  onEditRules?: () => void;
  /** Epoch ms of the season's first kickoff. Rules edits close at this time. */
  lockTime?: number | null;
}

export const NFLPoolRules: React.FC<NFLPoolRulesProps> = ({ pool, isManager, onEditRules, lockTime }) => {
  const castPool = pool as any;
  const type = pool.type;
  const settings = castPool.settings || {};
  const tiebreakerRule = effectiveWeeklyTiebreaker(settings as { weeklyTiebreaker?: unknown });

  const entryFee = settings.entryFee ?? 0;
  const lockBuffer = settings.lockBufferMinutes ?? 5;

  const branding = castPool.branding || {};
  const primaryAccent = branding.secondaryColor || '#C9A867';

  const locked = typeof lockTime === 'number' && Date.now() >= lockTime;
  const lockLabel = typeof lockTime === 'number'
    ? new Date(lockTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Commissioner edit banner — rules are editable until the first game of the season */}
      {isManager && (
        <div className={`rounded-xl p-5 border flex flex-wrap items-center justify-between gap-4 ${locked ? 'bg-surface border-line' : 'bg-gold-400/5 border-gold-500/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg border ${locked ? 'bg-card border-line text-muted' : 'bg-gold-400/10 border-gold-500/30 text-gold-700 dark:text-gold-400'}`}>
              {locked ? <Lock size={18} /> : <Settings size={18} />}
            </div>
            <div>
              <p className="font-display font-bold uppercase text-[13px] tracking-[0.04em] text-[color:var(--text)]">
                {locked ? 'Rules are locked' : 'You are the commissioner'}
              </p>
              <p className="text-[12px] text-muted font-body">
                {locked
                  ? 'The season has started — rules can no longer be changed.'
                  : lockLabel ? <>Editable until first kickoff · <span className="text-gold-700 dark:text-gold-400 font-bold">{lockLabel}</span></> : 'Edit your pool rules and settings.'}
              </p>
            </div>
          </div>
          {!locked && onEditRules && (
            <button
              onClick={onEditRules}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-colors"
            >
              <Settings size={14} /> Edit Rules &amp; Settings
            </button>
          )}
        </div>
      )}
      {/* Introduction Card */}
      <div className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden">
        <div
          className="absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primaryAccent }}
        />
        <div className="flex gap-4 items-start">
          <div className="p-3 bg-navy-800/5 dark:bg-gold-400/10 text-navy-700 dark:text-gold-400 border border-line rounded-lg">
            <HelpCircle size={22} />
          </div>
          <div>
            <h3 className="font-display font-bold uppercase text-lg leading-none text-[color:var(--text)] mb-2">NFL Pools Rules &amp; Specifications</h3>
            <p className="font-body text-muted text-[13px] leading-relaxed">
              Welcome to the pool dashboard! Below are the official configuration and scoring rules initialized by your commissioner. Ensure you submit and lock selections prior to weekly deadlines.
              The commissioner may name up to three co-commissioners to help run the pool (scoring, reminders, payments); only the commissioner can cancel or close it. A co-commissioner who also plays is bound by the same rules and deadlines as every other member.
            </p>
          </div>
        </div>
      </div>

      {/* Rules Details Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Card 1: Entry & Deadlines */}
        <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-4">
          <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
            <DollarSign size={14} className="text-gold-600 dark:text-gold-400" /> Entry &amp; Payout Settings
          </h4>
          <ul className="space-y-3.5 font-body text-[13px] text-[color:var(--text)]">
            <li className="flex justify-between border-b border-line pb-2">
              <span className="font-bold">Entry Fee:</span>
              <span className="font-display font-bold num">${entryFee}</span>
            </li>
            <li className="flex flex-col gap-1">
              <span className="font-bold">Payment Instructions:</span>
              <span className="text-muted italic bg-page p-2.5 border border-line rounded-md leading-normal text-[12px]">
                {settings.paymentInstructions || 'Please contact commissioner for payment.'}
              </span>
            </li>
          </ul>
        </div>

        {/* Card 2: Lock Deadlines */}
        <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-4">
          <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
            <Calendar size={14} className="text-gold-600 dark:text-gold-400" /> Lock Deadlines
          </h4>
          <ul className="space-y-3.5 font-body text-[13px] text-[color:var(--text)]">
            <li className="flex justify-between border-b border-line pb-2">
              <span className="font-bold">Lock Buffer Grace:</span>
              <span className="font-display font-bold num">{lockBuffer} Minutes Before Kickoff</span>
            </li>
            <li className="flex justify-between border-b border-line pb-2">
              <span className="font-bold">Lock Frequency Mode:</span>
              <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em]">
                {type === 'NFL_PICKEM' && settings.confidenceMode ? 'Strictly Weekly' :
                 type === 'NFL_PICKEM' && settings.lockMode === 'PER_GAME' ? 'Per-Game Kickoff' : 'Weekly (First Game Kickoff)'}
              </span>
            </li>
            <li className="leading-relaxed text-[12px] text-muted">
              <Zap size={12} className="inline-block align-[-1px] text-gold-600 dark:text-gold-400" aria-hidden="true" /> <strong>Note:</strong> Picks must be submitted prior to the kickoff lock. Locked selections cannot be edited by participants under any circumstance.
            </li>
          </ul>
        </div>

        {/* Card 3: Game Rules Specific to Pool Type */}
        {/* Resolved, never raw — an unset pool plays MNF_COMBINED and the
            rules page must say so rather than showing nothing. */}
        {type === 'NFL_PICKEM' && (
          <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-4 md:col-span-2">
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
              <Award size={14} className="text-gold-600 dark:text-gold-400" /> Pick'em Scoring &amp; Strategy Rules
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-body text-[13px] text-[color:var(--text)]">
              <div className="space-y-3">
                <p className="font-display font-bold uppercase text-sm tracking-[0.05em] text-[color:var(--text)]">General Rules</p>
                <ul className="list-disc list-inside space-y-2 leading-relaxed">
                  <li>
                    {settings.confidenceMode
                      ? 'Rank each game 1 to N. Higher rank = more points on a correct pick.'
                      : 'Pick the outright winner of every scheduled game each week.'}
                  </li>
                  <li>Ties and incorrect picks earn 0 points.</li>
                  <li>Cancelled games are voided and earn 0 points for all participants.</li>
                </ul>

                {/* Custom scoring display */}
                <div className="bg-page border border-line rounded-md p-3 space-y-1.5 mt-2">
                  <p className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-faint">Scoring Config</p>
                  {/* THE BASE-POINTS AND PRIMETIME-BONUS ROWS ARE GONE
                      (Kevin, 2026-08-22 — PLAN-DELETE-INERT-PICKEM-SCORING.md).
                      They read `settings.pointsPerPick` and
                      `settings.primetimeBonus`, which NOTHING that scores has
                      ever read: `scorePickemEntry` awards exactly 1 point per
                      correct pick on a non-confidence pool. A pool set to 3
                      told its members three here and paid one. The scorer is
                      unchanged; the false claim is what was removed. The
                      standard-scoring line below now names the real number. */}
                  {/* THE HOUSE RULE FOR A TIED WEEK. It belongs on the rules
                      page and not only on the pick sheet: the sheet asks for the
                      number, this says what the number decides — and on a NONE
                      pool the sheet asks nothing at all, so this is the only
                      place a member can learn that a tied week is shared.

                      🛑 THIS PAGE IS POOL-LEVEL AND CANNOT SPEAK FOR ONE WEEK
                      (codex r2 P2). It gets no `week` and no schedule, so it
                      cannot know that a particular week froze an EMPTY target
                      before the Monday-less fallback existed — a week whose
                      sheet correctly shows "No tiebreaker this week". Stating
                      the fallback flatly would contradict that sheet for the
                      same live week, which is the exact defect
                      PLAN-TIEBREAKER-MONDAYLESS was opened to fix.

                      So it states the RULE and hands the per-week answer to the
                      surface that actually knows it. That is a promise the
                      sheet keeps: it names the target game
                      (`tiebreakTargetSentence`) and renders the D2 card when a
                      week has none. */}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted font-bold flex items-center gap-1 shrink-0"><Trophy size={11} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Weekly Tie:</span>
                    <span className="text-[color:var(--text)] font-display font-bold text-right text-[12px]">
                      {tiebreakerRule === 'NONE' ? 'Shared — no tiebreaker'
                        : tiebreakerRule === 'MNF_LAST_GAME' ? 'Closest to the LAST Monday game total'
                          : tiebreakerRule === 'MNF_FIRST_GAME' ? 'Closest to the FIRST Monday game total'
                            : 'Closest to the combined Monday total'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">
                    {tiebreakerRule === 'NONE'
                      ? 'Players who finish a week level share it — this pool asks for no tiebreaker prediction.'
                      : 'Level on points? The player whose predicted score is closest wins the week. On a week with no Monday game, the final game of the week is the target. Still level after that, and it is shared. Your pick sheet names the game each week, and tells you when a week has none — that week is shared.'}
                  </p>
                  {/* Season-prize tie (PLAN-WEEKLY-PRIZES §2c / D4): pick record first, then split. */}
                  <p className="text-[11px] text-muted leading-relaxed mt-2">
                    <span className="font-bold">Season Tie:</span>{' '}
                    {settings.confidenceMode
                      ? 'Level on season points at the end? Most correct picks over the season ranks higher. Still level after that, and the season prize is shared.'
                      : 'Level on season points at the end? In standard scoring points are the correct-pick count, so there is nothing further to break — the season prize is shared.'}
                  </p>
                </div>
              </div>

              <div className="space-y-3 bg-page p-4 border border-line rounded-lg">
                <p className={`font-display font-bold uppercase tracking-[0.05em] text-sm flex items-center gap-1.5 ${
                  settings.confidenceMode ? 'text-navy-700 dark:text-gold-400' : 'text-muted'
                }`}>
                  <Zap size={14} />
                  {settings.confidenceMode ? 'Confidence Mode Active' : 'Standard Scoring Mode'}
                </p>
                <p className="leading-relaxed text-[12px] text-muted">
                  {settings.confidenceMode
                    ? `Assign a unique confidence weight from 1 to N for each game. Higher weight earns more points upon success. All games must have unique confidence ranks assigned.`
                    : 'Every correct pick earns 1 point. Confidence rankings are disabled in this pool.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {type === 'NFL_SURVIVOR' && (
          <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-4 md:col-span-2">
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
              <Shield size={14} className="text-gold-600 dark:text-gold-400" /> Survivor Rules
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-body text-[13px] text-[color:var(--text)]">
              <div className="space-y-3.5">
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="font-bold">Play Mode:</span>
                  <span className="font-display font-bold uppercase">
                    {settings.pickLosersMode ? 'Pick Team to Lose' : 'Pick Team to Win'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="font-bold">Mulligans / Strikes Allowed:</span>
                  <span className="font-display font-bold num">
                    {settings.maxStrikes === 0 ? 'Sudden Death (0 strikes)' : `${settings.maxStrikes} Strikes/Mulligans`}
                  </span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="font-bold">Tie Outcome:</span>
                  <span className="font-display font-bold">
                    {survivorRuleCopy(settings).tie}
                  </span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="font-bold">Team-Use Limit:</span>
                  <span className="font-display font-bold num">
                    {effectiveMaxTeamUses(settings) === UNLIMITED_TEAM_USES
                      ? 'Unlimited'
                      : `${effectiveMaxTeamUses(settings)} per team`}
                  </span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="font-bold">Auto-Survive Exemption:</span>
                  <span className="font-display font-bold">
                    {survivorRuleCopy(settings).autoSurvive}
                  </span>
                </div>
              </div>

              <div className="space-y-3 bg-page p-4 border border-line rounded-lg">
                <p className="font-display font-bold uppercase tracking-[0.05em] text-gold-600 dark:text-gold-400 text-sm flex items-center gap-1.5">
                  <RefreshCw size={14} /> Rebuy &amp; Strike Rules
                </p>
                <ul className="space-y-2 text-[12px] text-muted leading-relaxed list-disc list-inside">
                  <li>{survivorRuleCopy(settings).reuse}</li>
                  <li>
                    Rebuys: {survivorRebuyRuleCopy(settings, (w) => nflWeekLabel(poolSeasonType(castPool), w))}
                  </li>
                  <li>Failure to submit a pick yields an automatic strike at week-end.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {type === 'NFL_MARGIN' && (
          <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-4 md:col-span-2">
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
              <Award size={14} className="text-gold-600 dark:text-gold-400" /> Margin Scoring &amp; Cascade Tiebreakers
            </h4>
            <div className="space-y-4 font-body text-[13px] text-[color:var(--text)]">
              <p className="leading-relaxed">
                Pick a team each week. Your score is their margin of victory (e.g. if they win by 14, you get +14).
                If they lose, the negative margin counts against you. You cannot pick the same team twice in a season.
                <strong> Non-submissions penalize you with an automatic -14 margin score!</strong>
              </p>

              <div className="bg-page p-4 border border-line rounded-lg space-y-2.5">
                <p className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">5-Level Tiebreaker Standings Cascade:</p>
                <ol className="list-decimal list-inside space-y-1.5 num text-[12px] text-muted leading-normal">
                  <li>Highest Season Total victory margin.</li>
                  <li>Lowest Negative Burden (sum of absolute values of negative margins).</li>
                  <li>Most Positive Weeks (winning selections &gt; 0 margin).</li>
                  <li>Highest Single-Week margin score.</li>
                  <li>Deterministic ID comparison (display order only).</li>
                </ol>
                {/* PLAN-WEEKLY-PRIZES D4: the season prize uses the same cascade IN FULL AND IN ORDER; the ID step never separates a prize. */}
                <p className="text-[11px] text-muted leading-relaxed">
                  <span className="font-bold">Season prize ties</span> break on levels 1–4 above, in that order — the same cascade the standings show. Still level after level 4, and the prize is shared.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Prizes: shared payout transparency panel (fee, pot math, per-place amounts) */}
        <div className="md:col-span-2">
          <PayoutsPanel pool={pool} />
        </div>

      </div>
    </div>
  );
};
