import type { GameState, Winner } from '../types';
import { getLastDigit } from '../services/gameLogic';
import { PERIOD_LABELS } from '../constants';

export interface PeriodCard {
    period: string;
    label: string;
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
}

const sanitize = (n: any) => {
    if (n === null || n === undefined) return 0;
    const val = parseInt(n);
    return isNaN(val) ? 0 : val;
};

export const calculateQuarterlyPayouts = (squaresPool: GameState, winners: Winner[]): PeriodCard[] => {
    if (!squaresPool || (squaresPool.type && squaresPool.type !== 'SQUARES' && squaresPool.type !== 'PROPS')) return []; // Allow PROPS if they use this structure?
    // Note: If PROPS pool uses this, ensure logic valid. 
    // Usually PROPS pools don't have quarterly payouts based on squares.
    // However, user requested "Payout Structure Card" for the Props Grid page.
    // If it's a Props pool, this might be empty. But we should support standard logic.

    const periods = ['q1', 'half', 'q3', 'final'] as const;
    let accumulatedRollover = 0;

    const totalPot = squaresPool.squares
        ? (squaresPool.squares.filter(s => s && s.owner).length * squaresPool.costPerSquare)
        : 0;
    const charityDeduction = squaresPool.charity?.enabled ? Math.floor(totalPot * (squaresPool.charity.percentage / 100)) : 0;
    const netPot = totalPot - charityDeduction;

    return periods.map(period => {
        // CRITICAL FIX: For hybrid strategy, use hybrid weights instead of payouts
        let percent = 0;
        if (squaresPool.ruleVariations?.scoreChangePayout && squaresPool.ruleVariations?.scoreChangePayoutStrategy === 'hybrid') {
            // Use hybrid weights for Final and Halftime
            if (period === 'final') {
                percent = squaresPool.ruleVariations.scoreChangeHybridWeights?.final || 40;
            } else if (period === 'half') {
                percent = squaresPool.ruleVariations.scoreChangeHybridWeights?.halftime || 20;
            } else {
                // Q1 and Q3 don't have fixed payouts in hybrid mode
                percent = 0;
            }
        } else {
            // Standard quarterly payouts
            percent = squaresPool.payouts ? squaresPool.payouts[period] : 0;
        }

        const baseAmount = Math.floor(netPot * (percent / 100));
        let currentAmount = baseAmount;
        let rolloverContribution = 0;

        // Score Logic
        const scores = squaresPool.scores;
        const isFinal = scores ? !!scores[period] : false;
        const lockedScore = scores ? (scores as any)[period] : null;
        const liveScore = scores ? scores.current : null;
        const home = lockedScore ? sanitize(lockedScore.home) : sanitize(liveScore?.home);
        const away = lockedScore ? sanitize(lockedScore.away) : sanitize(liveScore?.away);

        // Previous Score
        let prevHome = 0, prevAway = 0;
        if (scores) {
            if (period === 'half') { prevHome = sanitize(scores.q1?.home); prevAway = sanitize(scores.q1?.away); }
            else if (period === 'q3') { prevHome = sanitize(scores.half?.home); prevAway = sanitize(scores.half?.away); }
            else if (period === 'final') { prevHome = sanitize(scores.q3?.home); prevAway = sanitize(scores.q3?.away); }
        }

        const qPointsHome = home - prevHome;
        const qPointsAway = away - prevAway;

        // Winner Logic
        let winnerName = "TBD";
        let reverseWinnerName: string | null = null;
        let hasWinner = false;

        // Check for Official Winner (Backend Authoritative)
        const officialWinner = winners.find(w => (w.period === period && !w.isReverse));
        const officialReverseWinner = winners.find(w => (w.period === period && w.isReverse === true));

        if (officialWinner) {
            winnerName = officialWinner.owner;
            hasWinner = true;
            if (officialReverseWinner) {
                reverseWinnerName = officialReverseWinner.owner;
            }
        } else if (squaresPool.axisNumbers) {
            const hD = getLastDigit(home);
            const aD = getLastDigit(away);

            if (scores?.gameStatus === 'in' || scores?.gameStatus === 'post' || isFinal) {
                const row = squaresPool.axisNumbers.away.indexOf(aD);
                const col = squaresPool.axisNumbers.home.indexOf(hD);
                if (row !== -1 && col !== -1) {
                    const owner = squaresPool.squares[row * 10 + col].owner;
                    if (owner) {
                        winnerName = owner;
                        hasWinner = true;
                    } else {
                        winnerName = squaresPool.ruleVariations?.quarterlyRollover ? "Rollover" : "Unsold";
                    }
                }
            }

            if (squaresPool.ruleVariations?.reverseWinners && hasWinner) {
                const rRow = squaresPool.axisNumbers.away.indexOf(hD);
                const rCol = squaresPool.axisNumbers.home.indexOf(aD);
                if (rRow !== -1 && rCol !== -1) {
                    const rSqId = rRow * 10 + rCol;
                    // Check logic for reverse
                    const row = squaresPool.axisNumbers.away.indexOf(aD);
                    const col = squaresPool.axisNumbers.home.indexOf(hD);
                    // Only if different square? Or always valid?
                    // Logic from App.tsx:
                    if (rSqId !== (row * 10 + col)) {
                        const rOwner = squaresPool.squares[rSqId].owner;
                        if (rOwner) reverseWinnerName = rOwner;
                    }
                }
            }
        }

        // Rollover Calculation
        const isRollover = winnerName === "Rollover";
        if (isRollover) {
            accumulatedRollover += baseAmount;
            currentAmount = 0;
        } else if (hasWinner) {
            rolloverContribution = accumulatedRollover;
            currentAmount += accumulatedRollover;
            accumulatedRollover = 0;
        }

        // Split for Reverse
        let finalAmount = currentAmount;
        if (reverseWinnerName) finalAmount = finalAmount / 2;

        return {
            period,
            label: PERIOD_LABELS[period] || period,
            amount: finalAmount,
            home,
            away,
            qPointsHome,
            qPointsAway,
            winnerName,
            reverseWinnerName,
            isPaid: officialWinner?.isPaid || false, // Assuming Winner type has isPaid
            isRollover,
            rolloverAdded: rolloverContribution,
            isLocked: isFinal
        };
    });
};
