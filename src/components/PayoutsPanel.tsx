import React from 'react';
import { DollarSign, Heart, Trophy, Zap } from 'lucide-react';
import type { Pool, GameState, CharityConfig, PayoutSettings } from '../types';
import { potBreakdown, weeklyPlacesFor } from '@shared/prizePot';

interface PayoutsPanelProps {
    pool: Pool;
    /**
     * Number of entries to base dollar estimates on (e.g. paid entries).
     * Falls back to pool.entryCount when omitted. When neither is available,
     * the panel renders percentages only — it never invents a pot size.
     */
    entryCount?: number;
    /** Compact variant for the invite/join page: fee, pot, top prizes only. */
    compact?: boolean;
}

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`;

const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const QUARTER_LABELS: { key: 'q1' | 'half' | 'q3' | 'final'; label: string }[] = [
    { key: 'q1', label: '1st Quarter' },
    { key: 'half', label: 'Halftime' },
    { key: 'q3', label: '3rd Quarter' },
    { key: 'final', label: 'Final Score' },
];

const UNSOLD_LABELS: Record<string, string> = {
    rollover_next: 'its prize rolls into the next scoring event (the pot grows)',
    split_winners: 'its prize is split among everyone who has already won',
    house: 'its prize is returned to the pool organizer',
};

const PAYOUT_MODE_COPY: Record<string, { label: string; explanation: string }> = {
    SEASON: {
        label: 'Season Standings',
        explanation: 'One payout at the end of the season, based on the final standings. The places below are season-long finishes.',
    },
    WEEKLY: {
        label: 'Weekly Winners',
        explanation: 'Prizes are paid out week by week to each week’s top finisher(s), rather than as one season-end payout.',
    },
    HYBRID: {
        label: 'Season + Weekly Hybrid',
        explanation: 'The prize pool is split between weekly winners and the final season standings. Ask your commissioner how the split works in this pool.',
    },
};

const FOOTER_COPY = 'Prizes are paid out by your commissioner, not by March Melee Pools.';

const Footer: React.FC = () => (
    <p className="text-[10px] font-body text-faint leading-relaxed border-t border-line pt-3">
        {FOOTER_COPY}
    </p>
);

/** Shared pot-math rows: gross pot, charity deduction, net prize pool. */
const PotBreakdown: React.FC<{
    grossPot?: number;
    potBasisLabel?: string;
    charity?: CharityConfig;
}> = ({ grossPot, potBasisLabel, charity }) => {
    const charityEnabled = Boolean(charity?.enabled && (charity?.percentage ?? 0) > 0);
    const charityCut = charityEnabled && grossPot !== undefined
        ? Math.floor(grossPot * ((charity as CharityConfig).percentage / 100))
        : undefined;
    const netPot = grossPot !== undefined ? grossPot - (charityCut ?? 0) : undefined;

    if (grossPot === undefined && !charityEnabled) return null;

    return (
        <div className="space-y-2 text-xs font-body">
            {grossPot !== undefined && (
                <div className="flex justify-between items-center border-b border-line pb-2">
                    <span className="font-bold text-[color:var(--text)]">
                        Total Pot{potBasisLabel ? <span className="text-faint font-normal num"> ({potBasisLabel})</span> : null}
                    </span>
                    <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{money(grossPot)}</span>
                </div>
            )}
            {charityEnabled && (
                <div className="flex justify-between items-center border-b border-line pb-2 text-brandred-600 dark:text-brandred-500">
                    <span className="font-bold flex items-center gap-1.5">
                        <Heart size={12} />
                        {(charity as CharityConfig).percentage}% to {(charity as CharityConfig).name || 'charity'} before payouts
                    </span>
                    {charityCut !== undefined && (
                        <span className="font-display font-bold num">-{money(charityCut)}</span>
                    )}
                </div>
            )}
            {netPot !== undefined && charityEnabled && (
                <div className="flex justify-between items-center border-b border-line pb-2">
                    <span className="font-bold text-[color:var(--text)]">Prize Pool After Donation</span>
                    <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{money(netPot)}</span>
                </div>
            )}
        </div>
    );
};

/** Computes gross/net pot for a squares pool from squares actually sold. */
const squaresPotMath = (gs: GameState) => {
    const costPerSquare = gs.costPerSquare ?? 0;
    const soldCount = Array.isArray(gs.squares)
        ? gs.squares.filter((s) => s && s.owner).length
        : undefined;
    const grossPot = soldCount !== undefined && costPerSquare > 0
        ? soldCount * costPerSquare
        : undefined;
    const charity = gs.charity;
    const charityCut = charity?.enabled && grossPot !== undefined
        ? Math.floor(grossPot * (charity.percentage / 100))
        : 0;
    const netPot = grossPot !== undefined ? grossPot - charityCut : undefined;
    return { costPerSquare, soldCount, grossPot, netPot, charity };
};

// ---------------------------------------------------------------------------
// Squares pools (GameState)
// ---------------------------------------------------------------------------

const SquaresPayouts: React.FC<{ gameState: GameState; compact: boolean }> = ({ gameState, compact }) => {
    const { costPerSquare, soldCount, grossPot, netPot, charity } = squaresPotMath(gameState);
    const rules = gameState.ruleVariations || ({} as GameState['ruleVariations']);
    const everyScorePays = Boolean(rules.scoreChangePayout);
    const potBasisLabel = soldCount !== undefined ? `based on ${soldCount} squares sold so far` : undefined;

    const dollarFor = (pct: number) =>
        netPot !== undefined && netPot > 0 ? ` (${money(netPot * (pct / 100))})` : '';


    if (compact) {
        return (
            <div className="space-y-3 text-left">
                <div className="flex justify-between items-center text-xs font-body border-b border-line pb-2">
                    <span className="font-bold text-[color:var(--text)]">Cost Per Square</span>
                    <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{money(costPerSquare)}</span>
                </div>
                <PotBreakdown grossPot={grossPot} potBasisLabel={potBasisLabel} charity={charity} />
                <p className="text-xs font-body text-[color:var(--text)] leading-relaxed num">
                    {everyScorePays
                        ? 'Every score pays: someone wins money every time the score changes.'
                        : QUARTER_LABELS
                            .filter(({ key }) => (gameState.payouts?.[key] ?? 0) > 0)
                            .map(({ key, label }) => `${label} ${gameState.payouts[key]}%${dollarFor(gameState.payouts[key])}`)
                            .join(' · ')}
                </p>
                <Footer />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="space-y-2 text-xs font-body">
                {costPerSquare > 0 && (
                    <div className="flex justify-between items-center border-b border-line pb-2">
                        <span className="font-bold text-[color:var(--text)]">Cost Per Square</span>
                        <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{money(costPerSquare)}</span>
                    </div>
                )}
            </div>
            <PotBreakdown grossPot={grossPot} potBasisLabel={potBasisLabel} charity={charity} />
            {soldCount !== undefined && (
                <p className="text-[11px] font-body text-faint leading-relaxed">
                    The pot grows as more squares sell — dollar amounts below are estimates based on squares sold so far.
                </p>
            )}

            {!everyScorePays && (
                <>
                    <ul className="space-y-2.5 text-xs font-body text-[color:var(--text)]">
                        {QUARTER_LABELS
                            .filter(({ key }) => (gameState.payouts?.[key] ?? 0) > 0)
                            .map(({ key, label }) => (
                                <li key={key} className="flex justify-between border-b border-line pb-1.5">
                                    <span className="font-bold">{label}</span>
                                    <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">
                                        {gameState.payouts[key]}% of the pot{dollarFor(gameState.payouts[key])}
                                    </span>
                                </li>
                            ))}
                    </ul>
                    {rules.quarterlyRollover ? (
                        <p className="text-[11px] font-body text-muted leading-relaxed">
                            If a winning square is unsold, that prize rolls over into the next quarter.
                            {rules.unclaimedFinalPrizeStrategy === 'random'
                                ? ' If the Final prize is unclaimed, a random sold square is drawn to win it.'
                                : ' If the Final prize is unclaimed, it goes to the most recent previous winner.'}
                        </p>
                    ) : (
                        <p className="text-[11px] font-body text-muted leading-relaxed">
                            Unclaimed prizes do not roll over in this pool.
                        </p>
                    )}
                </>
            )}

            {everyScorePays && (
                <div className="space-y-3">
                    <p className="text-xs font-body text-[color:var(--text)] leading-relaxed flex items-start gap-2">
                        <Zap size={14} className="text-gold-600 dark:text-gold-400 mt-0.5 shrink-0" />
                        <span>
                            <span className="font-bold text-[color:var(--text)]">Every score pays.</span> Someone wins money every time
                            the score changes — touchdowns, field goals, extra points, safeties.
                        </span>
                    </p>
                    {rules.scoreChangePayoutStrategy === 'equal_split' ? (
                        <p className="text-[11px] font-body text-muted leading-relaxed">
                            The prize pool is split evenly across every scoring event in the game, so each score is worth
                            the same amount. The exact amount per score depends on how many scores happen.
                        </p>
                    ) : (
                        (() => {
                            const w = rules.scoreChangeHybridWeights;
                            if (!w) {
                                return (
                                    <p className="text-[11px] font-body text-muted leading-relaxed">
                                        Larger shares of the pot are reserved for Halftime and the Final score; the rest is
                                        split across all other scoring events.
                                    </p>
                                );
                            }
                            return (
                                <ul className="space-y-2 text-xs font-body text-[color:var(--text)]">
                                    <li className="flex justify-between border-b border-line pb-1.5">
                                        <span className="font-bold">Final Score</span>
                                        <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{w.final}% of the pot{dollarFor(w.final)}</span>
                                    </li>
                                    <li className="flex justify-between border-b border-line pb-1.5">
                                        <span className="font-bold">Halftime</span>
                                        <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{w.halftime}% of the pot{dollarFor(w.halftime)}</span>
                                    </li>
                                    <li className="flex justify-between border-b border-line pb-1.5">
                                        <span className="font-bold">All Other Scores (split evenly)</span>
                                        <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{w.other}% of the pot{dollarFor(w.other)}</span>
                                    </li>
                                </ul>
                            );
                        })()
                    )}
                    <ul className="space-y-1.5 text-[11px] font-body text-muted leading-relaxed list-disc list-inside">
                        {rules.scoreChangeHandleUnsold && UNSOLD_LABELS[rules.scoreChangeHandleUnsold] && (
                            <li>If a winning square is unsold, {UNSOLD_LABELS[rules.scoreChangeHandleUnsold]}.</li>
                        )}
                        {rules.combineTDandXP !== undefined && (
                            <li>
                                {rules.combineTDandXP
                                    ? 'A touchdown and its extra point count as one payout event.'
                                    : 'A touchdown and its extra point count as separate payout events.'}
                            </li>
                        )}
                        {rules.includeOTInScorePayouts !== undefined && (
                            <li>
                                {rules.includeOTInScorePayouts
                                    ? 'Overtime scores also trigger payouts.'
                                    : 'Overtime scores do not trigger payouts.'}
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {rules.reverseWinners && (
                <p className="text-[11px] font-body text-navy-600 dark:text-gold-400 leading-relaxed">
                    Reverse winners is active: each prize is split 50/50 with the square matching the reversed digits.
                </p>
            )}

            <Footer />
        </div>
    );
};

// ---------------------------------------------------------------------------
// Entry-fee pools (bracket, NFL pick'em / survivor / margin, playoffs, props)
// ---------------------------------------------------------------------------

/**
 * One paid-place list. Extracted so a HYBRID pool with its own weekly places
 * (PLAN-PAYMENT-LEDGER T2 / D1) can print TWO of them — the weekly pot and the
 * season pot no longer share a place list — without the single-list pools
 * rendering anything different from what they render today.
 */
const PlaceList: React.FC<{
    heading?: string;
    places: { rank: number; percentage: number }[];
    potNoun: string;
    dollars: (pct: number) => string;
    hiddenCount?: number;
}> = ({ heading, places, potNoun, dollars, hiddenCount = 0 }) => (
    <div className="space-y-2">
        {heading && (
            <p className="font-display font-bold uppercase text-[10px] tracking-[0.12em] text-muted">{heading}</p>
        )}
        <ul className="space-y-2.5 text-xs font-body text-[color:var(--text)]">
            {places.map((p) => (
                <li key={p.rank} className="flex justify-between border-b border-line pb-1.5">
                    <span className="font-bold num">{ordinal(p.rank)} Place</span>
                    <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">
                        {p.percentage}% of {potNoun}{dollars(p.percentage)}
                    </span>
                </li>
            ))}
            {hiddenCount > 0 && (
                <li className="text-[11px] text-faint num">
                    +{hiddenCount} more paid place{hiddenCount !== 1 ? 's' : ''} — see the pool's Rules tab.
                </li>
            )}
        </ul>
    </div>
);

const EntryFeePayouts: React.FC<{ pool: Pool; entryCount?: number; compact: boolean }> = ({ pool, entryCount, compact }) => {
    const anyPool = pool as any;
    const settings = anyPool.settings || {};

    const entryFee: number = settings.entryFee ?? 0;
    const payouts: PayoutSettings | undefined = settings.payouts;
    const places = (payouts?.places || []).filter((p) => p.percentage > 0);
    const bonuses = (payouts?.bonuses || []).filter((b) => b.percentage > 0);
    const charity: CharityConfig | undefined = settings.charity;
    const payoutMode: string | undefined = settings.payoutMode;
    const modeCopy = payoutMode ? PAYOUT_MODE_COPY[payoutMode] : undefined;

    const entryNoun = pool.type === 'BRACKET' ? 'bracket' : 'entry';

    // Pot math: only when we actually know the entry count. Never guess.
    // ONE set of maths for this panel, the weekly prize list and the payment
    // ledger — `shared/prizePot.ts` (PLAN-WEEKLY-PRIZES §3b, PLAN-PAYMENT-LEDGER
    // R5). Whole dollars, floor, charity off BEFORE percentages; under HYBRID the
    // weekly pot floors and the season pot absorbs the remainder (codex r4/r5 on
    // #423). Amounts are approximations by design; the commissioner settles cents.
    const knownEntries: number | undefined =
        entryCount ?? (typeof anyPool.entryCount === 'number' ? anyPool.entryCount : undefined);
    const split = payoutMode === 'HYBRID' ? (settings.hybridSplit as { weeklyPerEntry?: number; seasonPerEntry?: number } | undefined) : undefined;
    const pots = potBreakdown(settings, knownEntries);
    const grossPot = pots?.gross;
    const netPot = pots?.net;
    // Absent split = pre-existing hybrid pool keeps the honest "ask your
    // commissioner" copy below.
    const splitPots = pots && payoutMode === 'HYBRID' && pots.weeklySeasonAllocation !== undefined && pots.seasonPot !== undefined
        ? { weekly: pots.weeklySeasonAllocation, season: pots.seasonPot }
        : undefined;

    // Under a declared HYBRID split the percentages apply to EACH pot, so one
    // combined figure would overstate every place (a 50% place on a $250 pot is
    // $90 weekly-total + $35 season, never $125). (codex P2 on the split PR.)
    const dollarFor = (pct: number) => {
        if (splitPots) {
            return ` (${money(splitPots.weekly * (pct / 100))} weekly total / ${money(splitPots.season * (pct / 100))} season)`;
        }
        return netPot !== undefined && netPot > 0 ? ` (${money(netPot * (pct / 100))})` : '';
    };

    // PLAN-PAYMENT-LEDGER T2 / D1: a HYBRID pool may declare its OWN weekly place
    // list. When it has, the two pots no longer share percentages, so one combined
    // line cannot describe either — the panel prints a list per pot. Absent
    // `weeklyPayouts`, everything below is byte-for-byte what shipped with #423.
    const separateWeekly = payoutMode === 'HYBRID' && Array.isArray(settings.weeklyPayouts?.places);
    const weeklyPlaces = separateWeekly
        ? weeklyPlacesFor(settings).filter((p) => p.percentage > 0)
        : [];
    const potDollars = (pot: number | undefined, pct: number, suffix = '') =>
        pot !== undefined && pot > 0 ? ` (${money(pot * (pct / 100))}${suffix})` : '';

    const hasAnyConfig = entryFee > 0 || places.length > 0 || weeklyPlaces.length > 0 || bonuses.length > 0 || Boolean(modeCopy);
    if (!hasAnyConfig) {
        if (compact) return null;
        return (
            <div className="space-y-4">
                <p className="text-xs font-body text-muted leading-relaxed">
                    No entry fee or prize structure has been configured for this pool. If you're expecting
                    payouts, check with your commissioner.
                </p>
                <Footer />
            </div>
        );
    }

    const topPlaces = compact ? places.slice(0, 3) : places;
    const topWeeklyPlaces = compact ? weeklyPlaces.slice(0, 3) : weeklyPlaces;

    return (
        <div className="space-y-4 text-left">
            <div className="space-y-2 text-xs font-body">
                {entryFee > 0 && (
                    <div className="flex justify-between items-center border-b border-line pb-2">
                        <span className="font-bold text-[color:var(--text)]">Entry Fee</span>
                        <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{money(entryFee)} per {entryNoun}</span>
                    </div>
                )}
            </div>

            <PotBreakdown
                grossPot={grossPot}
                potBasisLabel={knownEntries !== undefined && grossPot !== undefined ? `based on ${knownEntries} entries` : undefined}
                charity={charity}
            />

            {!compact && modeCopy && (
                <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs font-body border-b border-line pb-2">
                        <span className="font-bold text-[color:var(--text)]">Payout Format</span>
                        <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-[color:var(--text)]">{modeCopy.label}</span>
                    </div>
                    <p className="text-[11px] font-body text-muted leading-relaxed">
                        {split
                            ? `The entry fee splits $${split.weeklyPerEntry ?? 0} into the weekly prize pots and $${split.seasonPerEntry ?? 0} into the season pot, per entry. ${separateWeekly ? 'Each pot has its own prize places, listed below.' : 'The place percentages below apply to both pots.'} Dollar figures are rounded to whole dollars — your commissioner settles exact amounts.`
                            : modeCopy.explanation}
                    </p>
                    {splitPots && (
                        <div className="mt-2 flex gap-4 text-[11px] font-body font-bold num">
                            <span>Weekly pots: {money(splitPots.weekly)} total</span>
                            <span>Season pot: {money(splitPots.season)} total</span>
                        </div>
                    )}
                </div>
            )}

            {separateWeekly ? (
                <div className="space-y-4">
                    {topWeeklyPlaces.length > 0 && (
                        <PlaceList
                            heading="Weekly prizes"
                            places={topWeeklyPlaces}
                            potNoun="the weekly pot"
                            dollars={(pct) => potDollars(splitPots?.weekly, pct, ' weekly total')}
                            hiddenCount={weeklyPlaces.length - topWeeklyPlaces.length}
                        />
                    )}
                    {topPlaces.length > 0 && (
                        <PlaceList
                            heading="Season prizes"
                            places={topPlaces}
                            potNoun="the season pot"
                            dollars={(pct) => potDollars(splitPots?.season, pct)}
                            hiddenCount={places.length - topPlaces.length}
                        />
                    )}
                    {topWeeklyPlaces.length === 0 && (
                        <p className="text-[11px] font-body text-muted leading-relaxed">
                            This pool has no weekly prize places — the whole weekly pot is unassigned. Ask your commissioner.
                        </p>
                    )}
                </div>
            ) : topPlaces.length > 0 ? (
                <PlaceList
                    places={topPlaces}
                    potNoun="the pot"
                    dollars={dollarFor}
                    hiddenCount={places.length - topPlaces.length}
                />
            ) : null}

            {!compact && bonuses.length > 0 && (
                <ul className="space-y-2.5 text-xs font-body text-[color:var(--text)]">
                    {bonuses.map((b, i) => (
                        <li key={i} className="flex justify-between border-b border-line pb-1.5">
                            <span className="font-bold flex items-center gap-1.5">
                                <Trophy size={12} className="text-gold-600 dark:text-gold-400" /> {b.name || 'Bonus'}
                            </span>
                            {/* Bonuses live on `payouts`, which under a separate weekly
                                list is the SEASON list — pricing them off both pots
                                would double-count a bonus no weekly pot pays. */}
                            <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">
                                {b.percentage}% of {separateWeekly ? 'the season pot' : 'the pot'}
                                {separateWeekly ? potDollars(splitPots?.season, b.percentage) : dollarFor(b.percentage)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {/* `weeklyPlaces` counts too (codex r4): a HYBRID pool whose only
                paid places are weekly would otherwise print percentages with no
                word about why there are no dollars beside them. */}
            {grossPot === undefined && entryFee > 0 && (places.length > 0 || weeklyPlaces.length > 0 || bonuses.length > 0) && (
                <p className="text-[11px] font-body text-faint leading-relaxed">
                    Dollar amounts depend on how many entries join — percentages above are guaranteed by the pool's rules.
                </p>
            )}

            <Footer />
        </div>
    );
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

/**
 * Member-facing payout transparency panel — shows "if I win X, I get $Y"
 * before joining and during play, driven entirely by the pool's real config.
 * Rows for absent config are omitted; dollar amounts appear only when the
 * pot is actually computable (entry fee x known entries / squares sold).
 */
export const PayoutsPanel: React.FC<PayoutsPanelProps> = ({ pool, entryCount, compact = false }) => {
    const body = pool.type === 'SQUARES'
        ? <SquaresPayouts gameState={pool as GameState} compact={compact} />
        : <EntryFeePayouts pool={pool} entryCount={entryCount} compact={compact} />;

    if (compact) {
        // No card chrome — the host page provides its own container.
        return body;
    }

    return (
        <div className="bg-card border border-line rounded-3xl p-6 shadow-card space-y-4">
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted flex items-center gap-2">
                <DollarSign size={14} className="text-gold-600 dark:text-gold-400" /> Prizes
            </h4>
            {body}
        </div>
    );
};

export default PayoutsPanel;
