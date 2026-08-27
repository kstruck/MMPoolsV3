import React from 'react';
import { HelpCircle, Award, Zap, Scale } from 'lucide-react';
import type { BracketPool, Tournament } from '../../types';
import { getPointsForRound, getRoundLabel, SCORING_SYSTEM_LABELS } from './bracketScoring';
import { PayoutsPanel } from '../PayoutsPanel';

interface BracketRulesPanelProps {
    pool: BracketPool;
    tournament?: Tournament | null;
}

// SCORING_SYSTEM_LABELS moved to `./bracketScoring` in T12 so that the
// `settings.scoringSystem` help topic can name a pool's system from the same
// definition this panel prints. One sentence, one home (docs/help-voice.md
// rule 10).

/**
 * Member-facing scoring transparency panel for bracket pools.
 * Renders the pool's ACTUAL configured scoring rules (round values,
 * upset bonus, tiebreakers, entry fee / payouts) in plain language.
 * Driven entirely by pool.settings — rows for absent settings are omitted.
 */
export const BracketRulesPanel: React.FC<BracketRulesPanelProps> = ({ pool, tournament }) => {
    const settings = pool.settings;
    const scoringSystem = settings.scoringSystem;
    const systemLabel = SCORING_SYSTEM_LABELS[scoringSystem] || scoringSystem;

    // Determine how many rounds this bracket actually has.
    // NCAA default is 6; conference tournaments can be shorter.
    const isConference = tournament?.tournamentType === 'conference';
    const maxRound = tournament
        ? (Object.values(tournament.games).reduce((max, g) => Math.max(max, g.round), 0) || 6)
        : 6;

    const rounds = Array.from({ length: maxRound }, (_, i) => ({
        label: getRoundLabel(i, maxRound, isConference),
        points: getPointsForRound(i, settings),
    }));

    const upsetBonus = settings.upsetBonus;
    const upsetEnabled = Boolean(upsetBonus?.enabled);
    const upsetMultiplier = upsetBonus?.multiplier ?? 0;

    const closestUnder = Boolean(settings.tieBreakers?.closestUnder);

    const entryFee = settings.entryFee ?? 0;
    const payoutPlaces = settings.payouts?.places || [];
    const charity = settings.charity;
    const hasPrizeInfo = entryFee > 0 || payoutPlaces.length > 0 || Boolean(charity?.enabled);

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            {/* Introduction Card */}
            <div className="bg-card border border-line rounded-3xl p-6 shadow-card relative overflow-hidden">
                <div className="absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none bg-gold-500" />
                <div className="flex gap-4 items-start">
                    <div className="p-3 bg-gold-500/10 text-gold-600 border border-gold-500/20 rounded-2xl">
                        <HelpCircle size={22} />
                    </div>
                    <div>
                        <h3 className="text-lg font-display font-extrabold uppercase text-[color:var(--text)] mb-2">How Scoring Works in This Pool</h3>
                        <p className="text-muted font-body text-xs leading-relaxed">
                            These are the exact rules your commissioner configured for this pool. Every point on the
                            standings comes from the tables below — nothing else.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Card 1: Round-by-round point values */}
                <div className="bg-card border border-line rounded-3xl p-6 shadow-card space-y-4">
                    <h4 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em] flex items-center gap-2">
                        <Award size={14} className="text-gold-500" /> Points Per Correct Pick
                    </h4>
                    <div className="flex justify-between items-center border-b border-line pb-2 text-xs">
                        <span className="font-bold text-muted">Scoring System:</span>
                        <span className="text-[color:var(--text)] font-display font-extrabold uppercase text-[10px] tracking-wider text-right">{systemLabel}</span>
                    </div>
                    <ul className="space-y-2.5 text-xs text-muted font-body">
                        {rounds.map((r, i) => (
                            <li key={i} className="flex justify-between border-b border-line pb-1.5">
                                <span className="font-bold">{r.label}</span>
                                <span className="text-[color:var(--text)] font-extrabold num">{r.points} pts</span>
                            </li>
                        ))}
                    </ul>
                    <p className="leading-relaxed text-[11px] text-faint">
                        You earn the round's points each time a team you picked wins that game. Wrong picks earn 0 —
                        and once a team you picked loses, any later-round picks of that team can no longer score.
                    </p>
                </div>

                {/* Card 2: Upset bonus (only if enabled) + tiebreakers */}
                <div className="space-y-6">
                    {upsetEnabled && (
                        <div className="bg-card border border-line rounded-3xl p-6 shadow-card space-y-3">
                            <h4 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em] flex items-center gap-2">
                                <Zap size={14} className="text-gold-500" /> Upset Bonus
                            </h4>
                            <div className="flex justify-between border-b border-line pb-2 text-xs">
                                <span className="font-bold text-muted">Bonus per seed difference:</span>
                                <span className="text-gold-600 font-extrabold num">+{upsetMultiplier} pts</span>
                            </div>
                            <p className="leading-relaxed text-[11px] text-muted">
                                When you correctly pick an upset (a worse-seeded team beating a better-seeded team),
                                you earn a bonus on top of the round points: the seed difference &times; {upsetMultiplier}.
                            </p>
                            <div className="bg-surface border border-line rounded-xl p-3 text-[11px] text-muted leading-relaxed">
                                <span className="font-extrabold text-[color:var(--text)]">Example:</span> you pick a 12-seed to beat a
                                5-seed and they do. Seed difference is 7, so you get{' '}
                                <span className="text-gold-600 font-bold num">+{7 * upsetMultiplier} bonus pts</span>{' '}
                                in addition to the round points.
                            </div>
                        </div>
                    )}

                    <div className="bg-card border border-line rounded-3xl p-6 shadow-card space-y-3">
                        <h4 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em] flex items-center gap-2">
                            <Scale size={14} className="text-gold-500" /> How Ties Are Broken
                        </h4>
                        <ol className="list-decimal list-inside space-y-2 text-[11px] text-muted leading-relaxed">
                            <li>
                                <span className="font-bold text-[color:var(--text)]">Most points</span> — the standings are ranked
                                by current score first.
                            </li>
                            <li>
                                <span className="font-bold text-[color:var(--text)]">Highest possible finish</span> — if scores are
                                tied, the entry that can still earn more points from remaining games ranks higher.
                            </li>
                            <li>
                                <span className="font-bold text-[color:var(--text)]">Championship total prediction</span> — when you
                                submitted your bracket, you predicted the combined final score of the championship game.
                                {closestUnder
                                    ? ' If still tied once the championship ends, the prediction closest to the actual total WITHOUT going over wins (Price-is-Right style). If everyone went over, closest overall wins.'
                                    : ' If still tied once the championship ends, the entry whose prediction is closest to the actual total (over or under) wins.'}
                            </li>
                        </ol>
                    </div>
                </div>

                {/* Card 3: Prizes (shared payout transparency panel) + payment info */}
                {hasPrizeInfo && (
                    <>
                        <PayoutsPanel pool={pool} />
                        {(settings.paymentInstructions || settings.lockUnpaid) && (
                            <div className="bg-card border border-line rounded-3xl p-6 shadow-card space-y-3 text-xs text-muted font-body">
                                <h4 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em]">
                                    How to Pay
                                </h4>
                                {settings.paymentInstructions && (
                                    <div className="flex flex-col gap-1">
                                        <span className="font-bold">Payment Instructions:</span>
                                        <span className="text-muted italic bg-surface p-2.5 border border-line rounded-xl leading-normal text-[11px]">
                                            {settings.paymentInstructions}
                                        </span>
                                    </div>
                                )}
                                {settings.lockUnpaid && (
                                    <p className="leading-relaxed text-[11px] text-gold-700">
                                        Note: unpaid entries cannot submit final picks in this pool. Pay the commissioner
                                        to unlock submission.
                                    </p>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
