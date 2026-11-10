import type { GameState, Winner } from '../types';
import { PERIOD_LABELS } from '../constants';
import {
    computePeriodPayouts,
    isPlayerOwner,
    periodBase,
    PERIODS,
    ROLLOVER,
    scoreEventStrategy,
    UNSOLD,
    type PayoutPool,
    type Period,
    type PeriodResult,
    type PeriodScore,
    type RecordedWinners,
} from '@shared/squaresPayouts';

export interface PeriodCard {
    period: string;
    label: string;
    /** What the period's winner is paid (their half, when a reverse winner shares it). */
    amount: number;
    home: number;
    away: number;
    qPointsHome: number;
    qPointsAway: number;
    winnerName: string;
    reverseWinnerName?: string | null;
    isPaid?: boolean;
    isRollover?: boolean;
    rolloverAdded: number;
    isLocked: boolean;
    /** An unclaimed FINAL prize and who it went to (last winner, or the random draw). */
    bonusWinnerName?: string | null;
    bonusAmount?: number;
}

const sanitize = (n: string | number | undefined | null) => {
    if (n === null || n === undefined) return 0;
    const val = typeof n === 'string' ? parseInt(n) : n;
    return isNaN(val) ? 0 : val;
};

/** The winners already on record, in the shape the payout math takes them. */
export const recordedWinnersOf = (winners: ReadonlyArray<Winner>): RecordedWinners => {
    const out: Record<string, { squareId: number; owner: string | null; drawn?: boolean }> = {};
    for (const w of winners) {
        // Keyed by document id; the math only ever looks up period ids, so a
        // scoring-event record in here is simply never read.
        if (!w.id) continue;
        out[w.id] = {
            squareId: w.squareId,
            owner: w.owner ?? null,
            drawn: !!w.drawnAt,
        };
    }
    return out;
};

/**
 * The four period cards on a squares pool page.
 *
 * The amounts and winners come from `@shared/squaresPayouts` — the SAME function
 * the server records winners with — fed the winners already on record. This
 * used to be a second copy of the rules, and it disagreed with the server about
 * charity, reverse winners and rollover (PLAN-SQUARES-REOPEN M1–M3).
 *
 * A period that is not final yet is shown as a projection: "if it ended on the
 * current score". Before the game starts it shows the prize and "TBD".
 */
export const calculateQuarterlyPayouts = (squaresPool: GameState, winners: Winner[]): PeriodCard[] => {
    if (!squaresPool || (squaresPool.type && squaresPool.type !== 'SQUARES' && squaresPool.type !== 'PROPS')) return [];

    const pool = squaresPool as unknown as PayoutPool;
    const scores = squaresPool.scores;
    const live = scores?.current ?? null;
    const underway = scores?.gameStatus === 'in' || scores?.gameStatus === 'post';

    const finalScores: Partial<Record<Period, PeriodScore>> = {};
    const shownScores: Partial<Record<Period, PeriodScore>> = {};
    for (const p of PERIODS) {
        const locked = scores?.[p];
        if (locked) {
            finalScores[p] = { home: sanitize(locked.home), away: sanitize(locked.away) };
            shownScores[p] = finalScores[p];
        } else if (underway && live) {
            shownScores[p] = { home: sanitize(live.home), away: sanitize(live.away) };
        }
    }

    const results = new Map<Period, PeriodResult>(
        computePeriodPayouts(pool, shownScores, recordedWinnersOf(winners)).map((r) => [r.period, r]),
    );

    const strategy = scoreEventStrategy(pool);
    let carry = 0;
    return PERIODS.map((period) => {
        const isFinal = !!finalScores[period];
        const shown = shownScores[period] ?? { home: sanitize(live?.home), away: sanitize(live?.away) };

        const prev: Period | null = period === 'half' ? 'q1' : period === 'q3' ? 'half' : period === 'final' ? 'q3' : null;
        const prevScore = prev ? scores?.[prev] : null;
        const qPointsHome = shown.home - sanitize(prevScore?.home);
        const qPointsAway = shown.away - sanitize(prevScore?.away);

        const result = results.get(period);
        // Every-Score-Pays: equal split pays no period; hybrid pays only half and final.
        const paysNothing = strategy === 'equal_split' || (strategy === 'hybrid' && (period === 'q1' || period === 'q3'));
        let amount = 0;
        let winnerName = paysNothing ? '—' : 'TBD';
        let reverseWinnerName: string | null = null;
        let isRollover = false;
        let rolloverAdded = 0;
        let bonusWinnerName: string | null = null;
        let bonusAmount = 0;

        if (result) {
            const regular = result.claims.find((c) => c.docId === period);
            const reverse = result.claims.find((c) => c.docId === `${period}_reverse`);
            const bonus = result.claims.find((c) => c.docId === 'final_rollover');
            carry = result.rolloverOut;
            rolloverAdded = result.rolloverIn;
            if (regular) {
                winnerName = regular.owner;
                amount = regular.amount;
                isRollover = regular.owner === ROLLOVER;
            }
            if (reverse && isPlayerOwner(reverse.owner)) {
                reverseWinnerName = reverse.owner;
                // The regular square is unsold but its reverse was won: show that prize.
                if (regular && !regular.sold) amount = reverse.amount;
            }
            if (bonus) {
                bonusWinnerName = bonus.owner === ROLLOVER ? 'Awaiting random draw' : bonus.owner;
                bonusAmount = bonus.amount;
            }
        } else if (!paysNothing) {
            // Not played yet: its own share, plus anything rolled into it so far.
            amount = periodBase(pool, period) + carry;
            rolloverAdded = carry;
            carry = 0;
        }

        // A RECORD, where one exists, is what is shown. For a pool on the current
        // rules the server keeps the records equal to this math, so nothing
        // changes; for a pool played under the old rules the records are the
        // history of what was paid, and they are not second-guessed here.
        const official = winners.find((w) => w.id === period);
        const officialReverse = winners.find((w) => w.id === `${period}_reverse`);
        const officialBonus = period === 'final' ? winners.find((w) => w.id === 'final_rollover') : undefined;
        if (official) {
            winnerName = official.owner;
            isRollover = official.owner === ROLLOVER;
            if (typeof official.amount === 'number') amount = official.amount;
            reverseWinnerName = officialReverse && isPlayerOwner(officialReverse.owner) ? officialReverse.owner : null;
            if (reverseWinnerName && !isPlayerOwner(official.owner) && typeof officialReverse?.amount === 'number') {
                amount = officialReverse.amount;
            }
            bonusWinnerName = officialBonus ? (officialBonus.owner === ROLLOVER ? 'Awaiting random draw' : officialBonus.owner) : null;
            bonusAmount = officialBonus?.amount ?? 0;
        }

        return {
            period,
            label: PERIOD_LABELS[period] || period,
            amount,
            home: shown.home,
            away: shown.away,
            qPointsHome,
            qPointsAway,
            winnerName,
            reverseWinnerName,
            isPaid: official?.isPaid || false,
            isRollover,
            rolloverAdded,
            isLocked: isFinal,
            bonusWinnerName,
            bonusAmount,
        };
    });
};

export { UNSOLD, ROLLOVER };
