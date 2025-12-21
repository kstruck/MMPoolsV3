import type { GameState, Winner } from '../types';

// Helper to get the last digit of a score
export const getLastDigit = (score: number): number => {
  return score % 10;
};

// Generate random numbers 0-9 for axes
export const generateRandomAxis = (): number[] => {
  const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
};

export interface ScenarioResult {
  points: number;
  newDigit: number;
  owner: string;
}

// Calculate "What If" scenarios
export const calculateScenarioWinners = (state: GameState, scoringTeam: 'home' | 'away'): ScenarioResult[] => {
  if (!state.axisNumbers || !state.isLocked) return [];

  // Get current scores (use latest available or 0-0)
  const currentHome = (state.scores.final?.home ?? state.scores.q3?.home ?? state.scores.half?.home ?? state.scores.q1?.home ?? 0);
  const currentAway = (state.scores.final?.away ?? state.scores.q3?.away ?? state.scores.half?.away ?? state.scores.q1?.away ?? 0);

  const scenarios = [1, 2, 3, 6, 7, 8]; // Common football scores
  const results: ScenarioResult[] = [];

  scenarios.forEach(points => {
    let homeDigit, awayDigit;

    if (scoringTeam === 'home') {
      homeDigit = getLastDigit(currentHome + points);
      awayDigit = getLastDigit(currentAway);
    } else {
      homeDigit = getLastDigit(currentHome);
      awayDigit = getLastDigit(currentAway + points);
    }

    const rowIndex = state.axisNumbers!.away.indexOf(awayDigit);
    const colIndex = state.axisNumbers!.home.indexOf(homeDigit);

    if (rowIndex !== -1 && colIndex !== -1) {
      const squareId = rowIndex * 10 + colIndex;
      const owner = state.squares[squareId].owner || 'Unsold';

      results.push({
        points,
        newDigit: scoringTeam === 'home' ? homeDigit : awayDigit,
        owner
      });
    }
  });

  return results;
};

// Calculate winners based on current state
export const calculateWinners = (state: GameState): Winner[] => {
  if (!state.axisNumbers || !state.isLocked) return [];

  const winners: Winner[] = [];
  const totalPot = state.costPerSquare * 100;
  let distributablePot = totalPot;
  let hybridFinalPot = 0;
  let hybridHalfPot = 0;

  // 0. Handle Score Change Payouts
  if (state.ruleVariations.scoreChangePayout && state.scoreEvents.length > 0) {
    const strategy = state.ruleVariations.scoreChangePayoutStrategy || 'equal_split';
    const isHybrid = strategy === 'hybrid';

    // Pot Allocation Logic
    // Option A (Equal Split) = 100% of pot is for scores (technically, if not standard 25/25/25/25) 
    // BUT user said "Everyone who won an event gets that amount per event they won... Total pot is fixed".
    // This implies that for "Equal Split", there ARE NO quarterly payouts unless specified?
    // Wait, the user prompt said: "Option A: Split the total pot across all scoring events". 
    // This implies standard quarterly payouts might be disabled or secondary?
    // Let's assume for 'Equal Split', 100% of distributable is used, UNLESS user configured Payouts manually?
    // If "Every Score Wins" is ON, we should probably check if the user *also* wants quarterly prizes?
    // User request: "Hybrid... Reserve some money for 'big moments' so it doesn't all get diluted"
    // This implies Equal Split distributes EVERYTHING. 

    let scoreChangePot = 0;

    if (strategy === 'equal_split') {
      scoreChangePot = totalPot;
      distributablePot = 0; // All money goes to score changes
    } else if (isHybrid) {
      const weights = state.ruleVariations.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 };

      hybridFinalPot = (totalPot * weights.final) / 100;
      hybridHalfPot = (totalPot * weights.halftime) / 100;

      const remainingPct = 100 - weights.final - weights.halftime;
      scoreChangePot = (totalPot * remainingPct) / 100;

      distributablePot = 0; // Handled manually via hybrid variables
    }

    // Filter Events (Edge Cases)
    let validEvents = [...state.scoreEvents];

    // 1. Overtime Filtering
    if (state.ruleVariations.includeOTInScorePayouts === false) {
      // Naive check for "OT" in description if available
      validEvents = validEvents.filter(e => !e.description.toUpperCase().includes('OT') && !e.description.toUpperCase().includes('OVERTIME'));
    }

    // 2. TD + XP coalescing (Placeholder)
    if (state.ruleVariations.combineTDandXP) {
      // Logic to merge events would go here
    }

    const eventCount = validEvents.length;
    let runningRollover = 0;
    const baseAmountPerEvent = eventCount > 0 ? (scoreChangePot / eventCount) : 0;

    // Generate Winners
    validEvents.forEach((event, index) => {
      // Current Event Value
      let currentEventValue = baseAmountPerEvent + runningRollover;
      runningRollover = 0; // Reset unless we roll over again

      const homeDigit = getLastDigit(event.home);
      const awayDigit = getLastDigit(event.away);
      const row = state.axisNumbers!.away.indexOf(awayDigit);
      const col = state.axisNumbers!.home.indexOf(homeDigit);

      let winnerName = 'Unsold';
      let squareId = -1;

      if (row !== -1 && col !== -1) {
        squareId = row * 10 + col;
        winnerName = state.squares[squareId].owner || 'Unsold';
      }

      // Handle Unsold
      if (winnerName === 'Unsold') {
        const unsoldStrategy = state.ruleVariations.scoreChangeHandleUnsold || 'rollover_next';

        if (unsoldStrategy === 'house') {
          winnerName = 'Unsold (House)';
        } else if (unsoldStrategy === 'rollover_next') {
          // Accumulate and continue
          runningRollover += baseAmountPerEvent; // Determine base share to roll
          // If this is the LAST event, we can't roll over to "Next Score". 
          // It rolls to "Final Pot" or separate handling?
          // Let's assume it rolls to 'rolloverPot' used in end-of-game logic.
          if (index === eventCount - 1) {
            // Will be picked up by the 'Bonus' logic if we add it to the main rolloverPot?
            // Or just add a specific placeholder winner.
            winnerName = 'Rollover (Unclaimed)';
          } else {
            winnerName = 'Rollover to Next';
          }
        }
      }

      if (winnerName !== 'Rollover to Next') {
        winners.push({
          period: 'Event',
          squareId,
          owner: winnerName,
          amount: currentEventValue,
          homeDigit,
          awayDigit,
          description: event.description || `Score Change ${event.home}-${event.away}`,
          isRollover: winnerName === 'Rollover (Unclaimed)'
        });
      }
    });

    // If leftover rollover from score events
    if (runningRollover > 0) {
      // Technically this money is floating. 
      // We'll add it to the main quarterly rollover logic?
      // Or create a distinct 'Unclaimed Score Pot' winner.
      winners.push({
        period: 'Bonus',
        squareId: -1,
        owner: 'Unsold Score Pot',
        amount: runningRollover,
        homeDigit: -1,
        awayDigit: -1,
        description: 'Unclaimed Score Events'
      });
    }
  }

  // Ensure we don't have negative pot
  distributablePot = Math.max(0, distributablePot);

  // 1. Handle Period Winners (Percentages of Remaining Pot)
  const periods = ['q1', 'half', 'q3', 'final'] as const;
  let rolloverPot = 0;

  periods.forEach((period) => {
    const score = state.scores[period];
    if (score) {
      const homeDigit = getLastDigit(score.home);
      const awayDigit = getLastDigit(score.away);

      // Calculate Pot for this period based on the REMAINING distributable pot
      let basePeriodAmount = (distributablePot * state.payouts[period]) / 100;

      // Hybrid Override
      if (state.ruleVariations.scoreChangePayout && state.ruleVariations.scoreChangePayoutStrategy === 'hybrid') {
        if (period === 'final') basePeriodAmount = hybridFinalPot;
        else if (period === 'half') basePeriodAmount = hybridHalfPot;
      }

      const totalPeriodPot = basePeriodAmount + rolloverPot;

      // Reset rollover for this step
      rolloverPot = 0;

      // Identify Winning Coordinates
      let currentAxis = state.axisNumbers!;

      if (state.numberSets === 4 && state.quarterlyNumbers) {
        if (period === 'q1' && state.quarterlyNumbers.q1) currentAxis = state.quarterlyNumbers.q1;
        else if (period === 'half' && state.quarterlyNumbers.q2) currentAxis = state.quarterlyNumbers.q2;
        else if (period === 'q3' && state.quarterlyNumbers.q3) currentAxis = state.quarterlyNumbers.q3;
        else if (period === 'final' && state.quarterlyNumbers.q4) currentAxis = state.quarterlyNumbers.q4;
      }

      const mainRowIndex = currentAxis.away.indexOf(awayDigit);
      const mainColIndex = currentAxis.home.indexOf(homeDigit);

      let winningScenarios = [];

      // Main Scenario
      if (mainRowIndex !== -1 && mainColIndex !== -1) {
        winningScenarios.push({
          type: 'main',
          squareId: mainRowIndex * 10 + mainColIndex,
          home: homeDigit,
          away: awayDigit
        });
      }

      // Reverse Scenario
      if (state.ruleVariations.reverseWinners) {
        const revRowIndex = currentAxis.away.indexOf(homeDigit);
        const revColIndex = currentAxis.home.indexOf(awayDigit);
        if (revRowIndex !== -1 && revColIndex !== -1) {
          const revSquareId = revRowIndex * 10 + revColIndex;
          // Avoid double counting same square
          if (winningScenarios.length === 0 || winningScenarios[0].squareId !== revSquareId) {
            winningScenarios.push({
              type: 'reverse',
              squareId: revSquareId,
              home: awayDigit,
              away: homeDigit
            });
          }
        }
      }

      // Distribute Pot
      const amountPerWin = totalPeriodPot / (winningScenarios.length || 1);

      if (winningScenarios.length > 0) {
        winningScenarios.forEach(scenario => {
          const square = state.squares[scenario.squareId];

          if (square.owner) {
            winners.push({
              period,
              squareId: scenario.squareId,
              owner: square.owner,
              amount: amountPerWin,
              homeDigit: scenario.home,
              awayDigit: scenario.away,
              isReverse: scenario.type === 'reverse'
            });
          } else {
            // Square unsold
            if (state.ruleVariations.quarterlyRollover) {
              rolloverPot += amountPerWin;
              winners.push({
                period,
                squareId: -1,
                owner: 'ROLLOVER',
                amount: amountPerWin,
                homeDigit: scenario.home,
                awayDigit: scenario.away,
                isReverse: scenario.type === 'reverse',
                isRollover: true
              });
            } else {
              winners.push({
                period,
                squareId: scenario.squareId,
                owner: 'Unsold (House)',
                amount: amountPerWin,
                homeDigit: scenario.home,
                awayDigit: scenario.away,
                isReverse: scenario.type === 'reverse'
              });
            }
          }
        });
      } else {
        // No winning scenario (should happen only if logic fails, but treat as rollover)
        if (state.ruleVariations.quarterlyRollover) {
          rolloverPot += totalPeriodPot;
        }
      }
    }
  });

  // Handle Final Rollover (if any money remains unclaimed after Final)
  if (rolloverPot > 0 && state.ruleVariations.quarterlyRollover) {
    const strategy = state.ruleVariations.unclaimedFinalPrizeStrategy || 'last_winner';

    if (strategy === 'last_winner') {
      // Find the last real winner
      // We iterate backwards through winners array
      const lastWinnerIdx = winners.slice().reverse().findIndex(w => !w.isRollover && w.owner !== 'Unsold (House)');

      if (lastWinnerIdx !== -1) {
        // The index is in the reversed array, so translate to original
        const realIdx = winners.length - 1 - lastWinnerIdx;

        // Add a Bonus entry (or modify? Better to add new entry for clarity)
        winners.push({
          period: 'Bonus',
          squareId: winners[realIdx].squareId,
          owner: winners[realIdx].owner,
          amount: rolloverPot,
          homeDigit: winners[realIdx].homeDigit,
          awayDigit: winners[realIdx].awayDigit,
          description: 'Rollover Bonus (Last Winner Rule)'
        });

        // Zero out the pot locally (though function ends)
        rolloverPot = 0;
      }
    } else if (strategy === 'random') {
      if (state.randomWinner) {
        winners.push({
          period: 'Bonus',
          squareId: state.randomWinner.squareId,
          owner: state.randomWinner.owner,
          amount: rolloverPot,
          homeDigit: -1,
          awayDigit: -1,
          description: 'Rollover Bonus (Random Draw)'
        });
        rolloverPot = 0;
      } else {
        // Waiting for random draw
        winners.push({
          period: 'Bonus',
          squareId: -1,
          owner: 'PENDING RANDOM DRAW',
          amount: rolloverPot,
          homeDigit: -1,
          awayDigit: -1
        });
      }
    }
  }

  return winners;
};