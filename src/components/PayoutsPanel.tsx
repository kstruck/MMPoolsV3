import React from 'react';
import { DollarSign, Heart, Trophy, Zap } from 'lucide-react';
import type { Pool, GameState, CharityConfig, PayoutSettings } from '../types';

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
    <p className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-800/60 pt-3">
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
        <div className="space-y-2 text-xs">
            {grossPot !== undefined && (
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                    <span className="font-bold text-slate-300">
                        Total Pot{potBasisLabel ? <span className="text-slate-500 font-normal"> ({potBasisLabel})</span> : null}
                    </span>
                    <span className="text-white font-black font-mono">{money(grossPot)}</span>
                </div>
            )}
            {charityEnabled && (
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-2 text-rose-300">
                    <span className="font-bold flex items-center gap-1.5">
                        <Heart size={12} />
                        {(charity as CharityConfig).percentage}% to {(charity as CharityConfig).name || 'charity'} before payouts
                    </span>
                    {charityCut !== undefined && (
                        <span className="font-extrabold font-mono">-{money(charityCut)}</span>
                    )}
                </div>
            )}
            {netPot !== undefined && charityEnabled && (
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                    <span className="font-bold text-white">Prize Pool After Donation</span>
                    <span className="text-emerald-400 font-black font-mono">{money(netPot)}</span>
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
                <div className="flex justify-between items-center text-xs border-b border-slate-800/60 pb-2">
                    <span className="font-bold text-slate-300">Cost Per Square</span>
                    <span className="text-white font-black font-mono">{money(costPerSquare)}</span>
                </div>
                <PotBreakdown grossPot={grossPot} potBasisLabel={potBasisLabel} charity={charity} />
                <p className="text-xs text-slate-300 leading-relaxed">
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
            <div className="space-y-2 text-xs">
                {costPerSquare > 0 && (
                    <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                        <span className="font-bold text-slate-300">Cost Per Square</span>
                        <span className="text-white font-black font-mono">{money(costPerSquare)}</span>
                    </div>
                )}
            </div>
            <PotBreakdown grossPot={grossPot} potBasisLabel={potBasisLabel} charity={charity} />
            {soldCount !== undefined && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                    The pot grows as more squares sell — dollar amounts below are estimates based on squares sold so far.
                </p>
            )}

            {!everyScorePays && (
                <>
                    <ul className="space-y-2.5 text-xs text-slate-300">
                        {QUARTER_LABELS
                            .filter(({ key }) => (gameState.payouts?.[key] ?? 0) > 0)
                            .map(({ key, label }) => (
                                <li key={key} className="flex justify-between border-b border-slate-800/60 pb-1.5">
                                    <span className="font-bold">{label}</span>
                                    <span className="text-emerald-400 font-extrabold font-mono">
                                        {gameState.payouts[key]}% of the pot{dollarFor(gameState.payouts[key])}
                                    </span>
                                </li>
                            ))}
                    </ul>
                    {rules.quarterlyRollover ? (
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            If a winning square is unsold, that prize rolls over into the next quarter.
                            {rules.unclaimedFinalPrizeStrategy === 'random'
                                ? ' If the Final prize is unclaimed, a random sold square is drawn to win it.'
                                : ' If the Final prize is unclaimed, it goes to the most recent previous winner.'}
                        </p>
                    ) : (
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            Unclaimed prizes do not roll over in this pool.
                        </p>
                    )}
                </>
            )}

            {everyScorePays && (
                <div className="space-y-3">
                    <p className="text-xs text-slate-300 leading-relaxed flex items-start gap-2">
                        <Zap size={14} className="text-amber-400 mt-0.5 shrink-0" />
                        <span>
                            <span className="font-bold text-white">Every score pays.</span> Someone wins money every time
                            the score changes — touchdowns, field goals, extra points, safeties.
                        </span>
                    </p>
                    {rules.scoreChangePayoutStrategy === 'equal_split' ? (
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            The prize pool is split evenly across every scoring event in the game, so each score is worth
                            the same amount. The exact amount per score depends on how many scores happen.
                        </p>
                    ) : (
                        (() => {
                            const w = rules.scoreChangeHybridWeights;
                            if (!w) {
                                return (
                                    <p className="text-[11px] text-slate-400 leading-relaxed">
                                        Larger shares of the pot are reserved for Halftime and the Final score; the rest is
                                        split across all other scoring events.
                                    </p>
                                );
                            }
                            return (
                                <ul className="space-y-2 text-xs text-slate-300">
                                    <li className="flex justify-between border-b border-slate-800/60 pb-1.5">
                                        <span className="font-bold">Final Score</span>
                                        <span className="text-emerald-400 font-extrabold font-mono">{w.final}% of the pot{dollarFor(w.final)}</span>
                                    </li>
                                    <li className="flex justify-between border-b border-slate-800/60 pb-1.5">
                                        <span className="font-bold">Halftime</span>
                                        <span className="text-emerald-400 font-extrabold font-mono">{w.halftime}% of the pot{dollarFor(w.halftime)}</span>
                                    </li>
                                    <li className="flex justify-between border-b border-slate-800/60 pb-1.5">
                                        <span className="font-bold">All Other Scores (split evenly)</span>
                                        <span className="text-emerald-400 font-extrabold font-mono">{w.other}% of the pot{dollarFor(w.other)}</span>
                                    </li>
                                </ul>
                            );
                        })()
                    )}
                    <ul className="space-y-1.5 text-[11px] text-slate-400 leading-relaxed list-disc list-inside">
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
                <p className="text-[11px] text-indigo-300 leading-relaxed">
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
    const knownEntries: number | undefined =
        entryCount ?? (typeof anyPool.entryCount === 'number' ? anyPool.entryCount : undefined);
    const grossPot = entryFee > 0 && knownEntries !== undefined && knownEntries > 0
        ? entryFee * knownEntries
        : undefined;
    const charityCut = charity?.enabled && grossPot !== undefined
        ? Math.floor(grossPot * (charity.percentage / 100))
        : 0;
    const netPot = grossPot !== undefined ? grossPot - charityCut : undefined;

    const dollarFor = (pct: number) =>
        netPot !== undefined && netPot > 0 ? ` (${money(netPot * (pct / 100))})` : '';

    const hasAnyConfig = entryFee > 0 || places.length > 0 || bonuses.length > 0 || Boolean(modeCopy);
    if (!hasAnyConfig) {
        if (compact) return null;
        return (
            <div className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                    No entry fee or prize structure has been configured for this pool. If you're expecting
                    payouts, check with your commissioner.
                </p>
                <Footer />
            </div>
        );
    }

    const topPlaces = compact ? places.slice(0, 3) : places;

    return (
        <div className="space-y-4 text-left">
            <div className="space-y-2 text-xs">
                {entryFee > 0 && (
                    <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                        <span className="font-bold text-slate-300">Entry Fee</span>
                        <span className="text-white font-black font-mono">{money(entryFee)} per {entryNoun}</span>
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
                    <div className="flex justify-between items-center text-xs border-b border-slate-800/60 pb-2">
                        <span className="font-bold text-slate-300">Payout Format</span>
                        <span className="text-white font-black uppercase text-[10px] tracking-wider">{modeCopy.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{modeCopy.explanation}</p>
                </div>
            )}

            {topPlaces.length > 0 && (
                <ul className="space-y-2.5 text-xs text-slate-300">
                    {topPlaces.map((p) => (
                        <li key={p.rank} className="flex justify-between border-b border-slate-800/60 pb-1.5">
                            <span className="font-bold">{ordinal(p.rank)} Place</span>
                            <span className="text-emerald-400 font-extrabold font-mono">
                                {p.percentage}% of the pot{dollarFor(p.percentage)}
                            </span>
                        </li>
                    ))}
                    {compact && places.length > topPlaces.length && (
                        <li className="text-[11px] text-slate-500">
                            +{places.length - topPlaces.length} more paid place{places.length - topPlaces.length !== 1 ? 's' : ''} — see the pool's Rules tab.
                        </li>
                    )}
                </ul>
            )}

            {!compact && bonuses.length > 0 && (
                <ul className="space-y-2.5 text-xs text-slate-300">
                    {bonuses.map((b, i) => (
                        <li key={i} className="flex justify-between border-b border-slate-800/60 pb-1.5">
                            <span className="font-bold flex items-center gap-1.5">
                                <Trophy size={12} className="text-amber-400" /> {b.name || 'Bonus'}
                            </span>
                            <span className="text-amber-400 font-extrabold font-mono">
                                {b.percentage}% of the pot{dollarFor(b.percentage)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {grossPot === undefined && entryFee > 0 && (places.length > 0 || bonuses.length > 0) && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
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
        <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-4">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <DollarSign size={14} className="text-emerald-400" /> Prizes
            </h4>
            {body}
        </div>
    );
};

export default PayoutsPanel;
