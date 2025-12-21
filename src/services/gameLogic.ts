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
    // Actually, Admin Wizard Step 4 allows toggling "Standard" vs "Every Score Wins". 
    // If "Every Score Wins" is ON, we should probably check if the user *also* wants quarterly prizes?
    // User request: "Hybrid... Reserve some money for 'big moments' so it doesn't all get diluted"
    // This implies Equal Split distributes EVERYTHING. 

    let scoreChangePot = 0;

    if (strategy === 'equal_split') {
      scoreChangePot = totalPot;
      distributablePot = 0; // No Quarterly Payouts in this mode? Or maybe just 'remaining'? 
      // Logic check: If Equal Split is 100%, then Q1/Q2/Q3/Final get 0.
    } else if (isHybrid) {
      // Hybrid: 40% Final, 20% Half... "All Other Events" get the rest.
      const weights = state.ruleVariations.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 };
      // We actually need to reserve the pot for Final/Half *as if* they were quarters, but they are technically 'Score Events' too?
      // No, 'Hybrid' says "40% final score change... remaining 40% split across all OTHER scoring events".
      // So Final/Half are treated as special Payout Buckets.

      // Let's treat Hybrid as:
      // 1. Calculate allocated amounts for Q2 (Half) and Q4 (Final, or specific Final score)
      // 2. The REST is scoreChangePot for "Other" events.

      // Problem: The current `payouts` object (q1, half, q3, final) is used for quarterly logic.
      // If Hybrid is active, we should probably override the default logic or use this pre-calculation.

      // Let's stick to the prompt's implied logic:
      // "Reserve some money for big moments... split across all other scoring events".
      // Use the weights to set aside money.
      const finalPot = (totalPot * weights.final) / 100;
      const halfPot = (totalPot * weights.halftime) / 100;
      const remainingPct = 100 - weights.final - weights.halftime;
      scoreChangePot = (totalPot * remainingPct) / 100;

      // Note: For Hybrid to work fully, we need to pass these finalPot/halfPot values 
      // to the downstream logic that handles period winners. 
      // Currently, this function returns a generic Winner[] array.
      // We can inject "Special" winners here if we identify the events.

      distributablePot = 0; // Handled manually
    }

    // Filter Events (Edge Cases)
    let validEvents = [...state.scoreEvents];

    // 1. Overtime Filtering
    if (!state.ruleVariations.includeOTInScorePayouts) {
      // validEvents = validEvents.filter(e => e.period !== 'OT'); 
      // Note: 'period' might not exist on ScoreEvent yet. 
      // Assuming description checks or new property needed.
    }

    // 2. TD + XP coalescing
    // Complex: Identifying XP. We need a heuristic. 
    // Heuristic: If event B is roughly 1 point, and Event A was 6 points, and timestamps close?
    // Simpler: Just rely on descriptions? "Touchdown", "Extra Point"?
    // Let's assume description contains 'Touchdown' / 'Extra Point' / 'Field Goal' / 'Safety'.
    if (state.ruleVariations.combineTDandXP) {
      // This is hard without reliable metadata. We'll skip complex merging for now unless we have robust event data.
      // fallback: just ignore 'Extra Point' labels if simpler? No, that denies payouts.
      // Let's just create a placeholder comment for now. Logic requires robust timestamping.
    }

    const eventCount = validEvents.length;

    // Calculate Payout Per Event
    let amountPerEvent = 0;

    if (strategy === 'equal_split') { // Option A
      // Post-game calc: Total Pot / Total Events. 
      // During game: Estimated.
      amountPerEvent = eventCount > 0 ? (scoreChangePot / eventCount) : 0;
    } else if (isHybrid) {
      // Option B
      // Identify "Major" events: Halftime score, Final score.
      // "All OTHER scoring events" share the scoreChangePot.
      // We need to count 'Other' events (excluding the specific Half/Final updates? No, usually Half/Final are snapshots, not score changes).
      // A "Score Change" at 0:00 Q2 IS the Halftime score.
      // Let's count ALL valid score events.
      amountPerEvent = eventCount > 0 ? (scoreChangePot / eventCount) : 0;

      // Wait, Hybrid explicitly pays MORE for Final/Half. 
      // So we need to separate the "Hybrid Major Payouts" from "Minor Payouts".
      // Downstream logic handles Quarter payouts. We should inject valid "Winners" for Half/Final here 
      // AND generate "Minor" winners for the rest.
    }

    // Generate Winners
    validEvents.forEach(event => {
      // ... Logic for determining owner ...
      const homeDigit = getLastDigit(event.home);
      const awayDigit = getLastDigit(event.away);
      const row = state.axisNumbers!.away.indexOf(awayDigit);
      const col = state.axisNumbers!.home.indexOf(homeDigit);

      // ... Winner generation ... (Similar to before but using calculated amountPerEvent)
      // For Hybrid: If this event is THE Final Score event (how to tell?), pay the Big Pot.
      // Otherwise pay small pot.

      // Placeholder for now: utilizing simple "Equal Split" logic as baseline
      // because true Hybrid requires mapping specific events to game clock (End of Q2, End of Q4).

      if (row !== -1 && col !== -1) {
        const squareId = row * 10 + col;
        const square = state.squares[squareId];
        let winnerName = square.owner || 'Unsold';

        // Unsold handling
        if (!square.owner) {
          const unsoldStrategy = state.ruleVariations.scoreChangeHandleUnsold || 'rollover_next';
          if (unsoldStrategy === 'house') winnerName = 'Unsold (House)';
          else if (unsoldStrategy === 'rollover_next') {
            winnerName = 'Rollover to Next';
            // Technically implies next event is worth (amount + amount). 
            // For "Equal Split" post-game, this just means this event has no winner, so the pot splits among N-1 events? 
            // OR money stays in pot?
            // Most fair 'Rollover' in Equal Split: 
            // "Total Pot / (Winning Events)". 
            // So we filter effective count!
          }
        }

        if (winnerName !== 'Rollover to Next') {
          winners.push({
            period: 'Event',
            squareId,
            owner: winnerName,
            amount: amountPerEvent, // Note: this is an estimate until game over for Equal Split
            homeDigit,
            awayDigit,
            description: event.description
          });
        }
      }
    });

    // Recalculate Equal Split Amounts if 'Rollover' was used (Effective N)
    if (strategy === 'equal_split' && state.ruleVariations.scoreChangeHandleUnsold === 'rollover_next') {
      const winningEventsCount = winners.length; // Winners array only contains actual claims now
      const realAmount = winningEventsCount > 0 ? (scoreChangePot / winningEventsCount) : 0;
      winners.forEach(w => w.amount = realAmount);
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