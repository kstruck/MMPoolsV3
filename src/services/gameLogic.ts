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

  // 0. Handle Score Change Payouts (Fixed Amounts deducted from Total Pot)
  if (state.ruleVariations.scoreChangePayout && state.scoreEvents.length > 0) {
    state.scoreEvents.forEach(event => {
      const homeDigit = getLastDigit(event.home);
      const awayDigit = getLastDigit(event.away);

      const row = state.axisNumbers!.away.indexOf(awayDigit);
      const col = state.axisNumbers!.home.indexOf(homeDigit);

      if (row !== -1 && col !== -1) {
        const squareId = row * 10 + col;
        const square = state.squares[squareId];
        const amount = state.scoreChangePayoutAmount;

        // Deduct from main pot
        distributablePot -= amount;

        winners.push({
          period: 'Event',
          squareId: squareId,
          owner: square.owner || 'Unsold (House)',
          amount: amount,
          homeDigit: homeDigit,
          awayDigit: awayDigit,
          description: event.description // e.g. "TD Chiefs"
        });
      }
    });
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
      const basePeriodAmount = (distributablePot * state.payouts[period]) / 100;
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
        // Should logically not happen if axis are generated, but safety check
        if (state.ruleVariations.quarterlyRollover) {
          rolloverPot += totalPeriodPot;
        }
      }
    }
  });

  return winners;
};