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
    usesCurrentWinnerRules,
    type PayoutPool,
    type Period,
    type PeriodResult,
    type PeriodScore,
    type RecordedWinners,
} from '@shared/squaresPayouts';
import { recordedEntry } from '@shared/squaresWinnerPlan';

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
    /**
     * The WHOLE prize for the period — both halves when a reverse winner shares
     * it, and anything rolled into it. `amount` is one winner's share; a list
     * headed "1st Quarter (25%)" has to show the 25%, not half of it.
     */
    prize: number;
    /**
     * A finished quarter on a pool played under the OLD rules for which no
     * winner was ever recorded. The name is the owner of the square the score
     * lands on and the amount is that quarter's plain share — not a record, and
     * the page says so.
     */
    isUnrecorded?: boolean;
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
        // ONE reader for a record — the server's. A DRAWN final prize is read
        // from what the draw chose, not from the computed owner; this page had
        // its own copy of that rule, with its own null checks (qodo, PR #759).
        out[w.id] = recordedEntry({ id: w.id, data: w as unknown as Record<string, unknown> });
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
    const currentRules = usesCurrentWinnerRules(squaresPool);
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
            // A pool played under the old rules shows its RECORDS and nothing
            // worked out by today's math. The old server recorded an unsold
            // period as `Unsold` and rolled nothing forward; today's math would
            // read that as a rollover and caption the next card "includes $X
            // rolled over" — money that pool never moved (qodo, PR #759).
            if (!currentRules) rolloverAdded = 0;
        }

        // AN OLD POOL WITH NO RECORD FOR A FINISHED QUARTER. Its history was
        // never written down (a hand-scored pool recorded no winners before
        // 2026-11), so there is nothing to show as fact. What CAN be said
        // without today's rules is who owns the square the score lands on and
        // what that quarter's plain share of the pot is. Today's reverse-winner
        // split, rollover and unclaimed-prize handling are NOT applied to a
        // game that was not played under them, and the card is flagged so the
        // page does not present a worked-out figure as a recorded one (qodo,
        // PR #759).
        let isUnrecorded = false;
        if (!currentRules && !official && isFinal && result && !paysNothing) {
            const regular = result.claims.find((c) => c.docId === period);
            isUnrecorded = true;
            winnerName = regular && isPlayerOwner(regular.owner) ? regular.owner : UNSOLD;
            amount = periodBase(pool, period);
            reverseWinnerName = null;
            isRollover = false;
            rolloverAdded = 0;
            bonusWinnerName = null;
            bonusAmount = 0;
        }

        // The whole prize for the period. On a pool with records that are not
        // today's math (old rules, or an unrecorded quarter) it is what those
        // records and that card say, not the engine's figure.
        const recordedTotal = official
            ? [official, officialReverse].reduce((sum, w) => sum + (w && isPlayerOwner(w.owner) && typeof w.amount === 'number' ? w.amount : 0), 0)
            : null;
        const prize = result && currentRules ? result.prize : (recordedTotal !== null && recordedTotal > 0 ? recordedTotal : amount);

        return {
            period,
            label: PERIOD_LABELS[period] || period,
            amount,
            prize,
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
            isUnrecorded,
            bonusWinnerName,
            bonusAmount,
        };
    });
};

/** `$12`, `$12.50`, `$1,250` — whole dollars bare, anything else to the cent. Never `$12.5`. */
export function formatPrize(n: number | null | undefined): string {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    return '$' + v.toLocaleString(undefined, Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PERIOD_RECORD_ORDER = ['final_rollover', 'final', 'final_reverse', 'q3', 'q3_reverse', 'half', 'half_reverse', 'q1', 'q1_reverse'];

/**
 * Who the "In the money" banner names: the most recent winner who is A PLAYER.
 *
 * It used to take the last record in the list. The list comes back in
 * document-id order, so with reverse winners on that was `q1_reverse` — and
 * when that square was unsold, the banner read "IN THE MONEY: ROLLOVER".
 *
 * Latest quarter first; within a quarter the winning square before its reverse.
 * A winner with a prize comes before one whose prize is $0. Scoring-event
 * winners (Every Score Pays) count only when no quarter has a player winner,
 * most recent event first.
 */
export function latestPlayerWinner(winners: ReadonlyArray<Winner>): string | null {
    for (const id of PERIOD_RECORD_ORDER) {
        const w = winners.find((x) => x.id === id);
        if (w && isPlayerOwner(w.owner) && (w.amount ?? 0) > 0) return w.owner;
    }
    for (const id of PERIOD_RECORD_ORDER) {
        const w = winners.find((x) => x.id === id);
        if (w && isPlayerOwner(w.owner)) return w.owner;
    }
    const events = winners.filter((w) => typeof w.id === 'string' && w.id.startsWith('event_') && isPlayerOwner(w.owner));
    return events.length > 0 ? events[events.length - 1].owner : null;
}

/**
 * The three totals on the commissioner's Payouts tab, from the winner records.
 *
 *   - `won`     — every prize a PLAYER has won, at what it is now.
 *   - `paid`    — what was actually HANDED OVER: the amount each prize was at
 *                 the moment it was marked paid, not what it has since become.
 *   - `pending` — what is still to hand over.
 *
 * `pending` is NOT `won − paid`. A prize can fall after it was paid — a drawn
 * prize set to $0, charity switched on late — and the difference then went
 * negative, on a page a commissioner reads as "what I still owe" (qodo, PR
 * #759). An unpaid prize is owed in full; a paid one is owed only what it has
 * GROWN by since. One that was overpaid owes nothing here; its row says so.
 */
export function payoutTotals(winners: ReadonlyArray<Winner>): { won: number; paid: number; pending: number } {
    let won = 0, paid = 0, pending = 0;
    for (const w of winners) {
        if (!isPlayerOwner(w.owner)) continue;
        const amount = typeof w.amount === 'number' && Number.isFinite(w.amount) ? w.amount : 0;
        won += amount;
        if (w.isPaid) {
            const handed = typeof w.paidAmount === 'number' && Number.isFinite(w.paidAmount) ? w.paidAmount : amount;
            paid += handed;
            pending += Math.max(0, amount - handed);
        } else {
            pending += amount;
        }
    }
    return { won, paid, pending };
}

export { UNSOLD, ROLLOVER };
