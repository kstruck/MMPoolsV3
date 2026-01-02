import { dbService } from '../../../services/dbService';
import { createNewPool } from '../../../constants';
import type { TestStepResult } from '../testingOrchestrator';
import {
    generateTestUsers,
    log,
    delay,
    trackResource
} from './common';
import { simulatePoolGame } from '../../simulationUtils';

export interface SimulatorResult {
    poolId?: string;
    steps: TestStepResult[];
    finalPoolData?: any;
    winners?: any[];
    finalStatus?: string;
    error?: string;
}

export async function runScenario(
    scenario: string,
    mode: 'dry-run' | 'actual',
    settings?: Record<string, any>
): Promise<SimulatorResult> {
    const steps: TestStepResult[] = [];
    const startTime = Date.now();
    let poolId: string | undefined;

    // Helper to log step result
    const addStep = (step: string, status: 'success' | 'failed' | 'skipped', message: string, data?: any) => {
        steps.push({
            step,
            status,
            message,
            duration: Date.now() - startTime, // Simplified duration
            data
        });
        log(status === 'success' ? 'success' : status === 'failed' ? 'error' : 'info', `[${step}] ${message}`, data);
    };

    try {
        if (mode === 'dry-run') {
            addStep('Initialization', 'success', 'Dry run started - skipping DB operations');
            return { steps };
        }

        // 1. SETUP: Create Pool
        const poolName = `AI Test - ${scenario} - ${new Date().toISOString().split('T')[1]}`;
        // Assumes current user (admin) is owner.
        // We use 'createNewPool' from constants which likely needs an owner ID. 
        // Since we are in client context, we might rely on authService.currentUser (if global) 
        // OR we just pass a placeholder and rely on Cloud Function to override/validate with context.auth.
        // Actually, createNewPool just returns an object.
        const basePool = createNewPool(poolName, 'test_admin_uid', 'SQUARES');

        // Apply Settings overrides
        if (settings) {
            Object.assign(basePool, settings);
        }

        addStep('Create Pool', 'success', `Creating pool: ${poolName}`);
        poolId = await dbService.createPool(basePool);
        trackResource('pool', poolId!, { scenario });
        addStep('Create Pool', 'success', `Pool created with ID: ${poolId}`);

        // 2. SCENARIO EXECUTION
        switch (scenario) {
            case 'basic-100':
                await runBasic100Scenario(poolId!, addStep, settings);
                break;
            case 'partial-fill':
                await runPartialFillScenario(poolId!, addStep);
                break;
            default:
                addStep('Scenario Execution', 'skipped', `Scenario logic for "${scenario}" not implemented`);
        }

    } catch (error: any) {
        addStep('Error', 'failed', error.message);
        throw error;
    }

    return { poolId, steps };
}

// --- SCENARIO IMPLEMENTATIONS ---

async function runBasic100Scenario(
    poolId: string,
    addStep: (step: string, status: 'success' | 'failed' | 'skipped', message: string, data?: any) => void,
    settings?: Record<string, any>
) {
    // A. Generate/Simulate Users
    addStep('Setup Users', 'success', 'Generating 10 test users');
    const testUsers = generateTestUsers(10); // 10 users taking 10 squares each

    // B. Reserve Squares
    addStep('Reserve Squares', 'success', 'Starting reservoir of 100 squares...');

    // Create an array of 0-99
    const squareIds = Array.from({ length: 100 }, (_, i) => i);

    // Shuffle squares for randomness
    for (let i = squareIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [squareIds[i], squareIds[j]] = [squareIds[j], squareIds[i]];
    }

    // Assign 10 squares to each user
    const chunkSize = 10;
    let processed = 0;

    for (const user of testUsers) {
        const mySquares = squareIds.slice(processed, processed + chunkSize);

        // Reserve sequentially (awaiting to avoid rate limits/race conditions, or batching)
        // Cloud functions can handle parallel, but let's be safe with strict concurrency control.
        await Promise.all(mySquares.map(sqId =>
            dbService.reserveSquare(poolId, sqId, {
                email: user.email,
                name: user.name
            }, undefined, user.name)
        ));

        processed += chunkSize;
        // log('info', `Reserved ${chunkSize} squares for ${user.name}`);
    }

    addStep('Reserve Squares', 'success', 'Successfully reserved 100 squares');

    // C. Lock Pool (Generates Numbers)
    addStep('Lock Pool', 'success', 'Locking pool and generating axis numbers');
    await dbService.lockPool(poolId);
    // Verification: We could fetch the pool to confirm, but if no error thrown, we assume success.

    // D. Simulate Game
    addStep('Simulate Game', 'success', 'Simulating game scores...');

    const customLogic = settings?._fullScenario;
    // Support both old 'userActions' and new 'actions' formats
    const actions = customLogic?.actions || customLogic?.userActions || [];

    // Check for NEW format (Multiple SCORE_UPDATE actions)
    const scoreUpdates = actions.filter((a: any) => a.actionType === 'SCORE_UPDATE');

    // Check for OLD format (Single Record Game Scores action)
    const oldScoreAction = actions.find((a: any) => a.action === 'Record Game Scores');

    // DEBUG: Log actions if none found
    if (scoreUpdates.length === 0 && !oldScoreAction) {
        if (actions.length > 0) {
            addStep('Simulate Game', 'success', `Debug: Found ${actions.length} actions but no score updates. Types: ${actions.map((a: any) => a.actionType || a.action).join(', ')}`);
        } else {
            addStep('Simulate Game', 'success', 'Debug: No actions found in scenario.');
        }
    }

    if (scoreUpdates.length > 0) {
        addStep('Simulate Game', 'success', `Using AI-generated SCORE_UPDATE actions (${scoreUpdates.length} updates)`);

        for (const update of scoreUpdates) {
            const payload: any = { gameStatus: 'IN_PROGRESS', clock: '0:00', startTime: new Date().toISOString() };
            let currentHome = 0;
            let currentAway = 0;

            if (update.period === 'Q1') {
                payload.q1Home = update.homeScore;
                payload.q1Away = update.awayScore;
                currentHome = update.homeScore;
                currentAway = update.awayScore;
                payload.period = 1;
                payload.q1 = { home: update.homeScore, away: update.awayScore };
            } else if (update.period === 'Q2' || update.period === 'Q2_HALFTIME') {
                payload.q2Home = update.homeScore;
                payload.q2Away = update.awayScore;
                currentHome = update.homeScore;
                currentAway = update.awayScore;
                payload.period = 2;
                payload.half = { home: update.homeScore, away: update.awayScore };
                // Carry over previous
                const q1 = scoreUpdates.find((u: any) => u.period === 'Q1');
                if (q1) payload.q1 = { home: q1.homeScore, away: q1.awayScore };
            } else if (update.period === 'Q3') {
                payload.q3Home = update.homeScore;
                payload.q3Away = update.awayScore;
                currentHome = update.homeScore;
                currentAway = update.awayScore;
                payload.period = 3;
                payload.q3 = { home: update.homeScore, away: update.awayScore };
                // Carry over previous
                const q1 = scoreUpdates.find((u: any) => u.period === 'Q1');
                if (q1) payload.q1 = { home: q1.homeScore, away: q1.awayScore };
                const half = scoreUpdates.find((u: any) => u.period === 'Q2' || u.period === 'Q2_HALFTIME');
                if (half) payload.half = { home: half.homeScore, away: half.awayScore };
            } else if (update.period === 'FINAL' || update.period === 'GAME_END') {
                payload.finalHome = update.homeScore;
                payload.finalAway = update.awayScore;
                payload.gameStatus = 'FINAL';
                currentHome = update.homeScore;
                currentAway = update.awayScore;
                payload.period = 4;
                payload.final = { home: update.homeScore, away: update.awayScore };
                // Carry over previous
                const q1 = scoreUpdates.find((u: any) => u.period === 'Q1');
                if (q1) payload.q1 = { home: q1.homeScore, away: q1.awayScore };
                const half = scoreUpdates.find((u: any) => u.period === 'Q2' || u.period === 'Q2_HALFTIME');
                if (half) payload.half = { home: half.homeScore, away: half.awayScore };
                const q3 = scoreUpdates.find((u: any) => u.period === 'Q3');
                if (q3) payload.q3 = { home: q3.homeScore, away: q3.awayScore };
            } else if (update.period === 'Q4') {
                // Handle Q4 explicit updates (same as FINAL usually, but keep game IN_PROGRESS if wanted, or treat as FINAL)
                // Assuming Q4 means "End of Q4" which is effectively FINAL/regulation.
                payload.finalHome = update.homeScore;
                payload.finalAway = update.awayScore;
                payload.period = 4;
                payload.gameStatus = 'post';
                currentHome = update.homeScore;
                currentAway = update.awayScore;
                payload.final = { home: update.homeScore, away: update.awayScore };
                // Carry over previous
                const q1 = scoreUpdates.find((u: any) => u.period === 'Q1');
                if (q1) payload.q1 = { home: q1.homeScore, away: q1.awayScore };
                const half = scoreUpdates.find((u: any) => u.period === 'Q2' || u.period === 'Q2_HALFTIME');
                if (half) payload.half = { home: half.homeScore, away: half.awayScore };
                const q3 = scoreUpdates.find((u: any) => u.period === 'Q3');
                if (q3) payload.q3 = { home: q3.homeScore, away: q3.awayScore };
            } else {
                // Fallback for unknown periods (e.g. "OT", "Overtime", or typos)
                addStep('Simulate Game', 'success', `Unknown period "${update.period}" encountered. Defaulting to Period 4.`);
                payload.period = 4;
                // We should probably set current score at least
                currentHome = update.homeScore;
                currentAway = update.awayScore;
            }

            payload.current = { home: currentHome, away: currentAway };
            await simulatePoolGame(poolId, payload);
            await delay(1000);
        }
        addStep('Simulate Game', 'success', 'Custom score updates applied successfully.');

    } else if (oldScoreAction && Array.isArray(oldScoreAction.scores)) {
        addStep('Simulate Game', 'success', 'Using Legacy AI-generated custom score scenario');

        // Map AI score format (array) to Simulator format (flat object)
        const mappedScores: any = {};
        for (const s of oldScoreAction.scores) {
            if (s.quarter.includes('1st')) { mappedScores.q1Home = s.teamAScore; mappedScores.q1Away = s.teamBScore; }
            if (s.quarter.includes('2nd') || s.quarter.includes('Halftime')) { mappedScores.q2Home = s.teamAScore; mappedScores.q2Away = s.teamBScore; }
            if (s.quarter.includes('3rd')) { mappedScores.q3Home = s.teamAScore; mappedScores.q3Away = s.teamBScore; }
            if (s.quarter.includes('Final')) { mappedScores.finalHome = s.teamAScore; mappedScores.finalAway = s.teamBScore; }
        }

        // Run updates sequentially with gameStatus
        if (mappedScores.q1Home !== undefined) {
            await simulatePoolGame(poolId, { q1Home: mappedScores.q1Home, q1Away: mappedScores.q1Away, current: { home: mappedScores.q1Home, away: mappedScores.q1Away }, q1: { home: mappedScores.q1Home, away: mappedScores.q1Away }, period: 1, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'IN_PROGRESS' });
            await delay(1000);
        }
        if (mappedScores.q2Home !== undefined) {
            await simulatePoolGame(poolId, {
                q2Home: mappedScores.q2Home, q2Away: mappedScores.q2Away,
                current: { home: mappedScores.q2Home, away: mappedScores.q2Away },
                half: { home: mappedScores.q2Home, away: mappedScores.q2Away },
                q1: mappedScores.q1Home !== undefined ? { home: mappedScores.q1Home, away: mappedScores.q1Away } : undefined,
                period: 2, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'IN_PROGRESS'
            });
            await delay(1000);
        }
        if (mappedScores.q3Home !== undefined) {
            await simulatePoolGame(poolId, {
                q3Home: mappedScores.q3Home, q3Away: mappedScores.q3Away,
                current: { home: mappedScores.q3Home, away: mappedScores.q3Away },
                q3: { home: mappedScores.q3Home, away: mappedScores.q3Away },
                q1: mappedScores.q1Home !== undefined ? { home: mappedScores.q1Home, away: mappedScores.q1Away } : undefined,
                half: mappedScores.q2Home !== undefined ? { home: mappedScores.q2Home, away: mappedScores.q2Away } : undefined,
                period: 3, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'IN_PROGRESS'
            });
            await delay(1000);
        }
        if (mappedScores.finalHome !== undefined) {
            await simulatePoolGame(poolId, {
                finalHome: mappedScores.finalHome, finalAway: mappedScores.finalAway,
                current: { home: mappedScores.finalHome, away: mappedScores.finalAway },
                final: { home: mappedScores.finalHome, away: mappedScores.finalAway },
                q1: mappedScores.q1Home !== undefined ? { home: mappedScores.q1Home, away: mappedScores.q1Away } : undefined,
                half: mappedScores.q2Home !== undefined ? { home: mappedScores.q2Home, away: mappedScores.q2Away } : undefined,
                q3: mappedScores.q3Home !== undefined ? { home: mappedScores.q3Home, away: mappedScores.q3Away } : undefined,
                period: 4, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'post'
            });
        }

        addStep('Simulate Game', 'success', `Custom game simulation complete. Final: ${mappedScores.finalHome}-${mappedScores.finalAway}`);
    } else {
        // Default Random Simulation
        addStep('Simulate Game', 'success', 'Simulating random game scores (Default)...');
        await simulatePoolGame(poolId, { q1Home: 7, q1Away: 3, current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, period: 1, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'IN_PROGRESS' });
        await delay(1000);
        await simulatePoolGame(poolId, {
            q2Home: 14, q2Away: 10, current: { home: 14, away: 10 }, half: { home: 14, away: 10 },
            q1: { home: 7, away: 3 },
            period: 2, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'IN_PROGRESS'
        });
        await delay(1000);
        await simulatePoolGame(poolId, {
            q3Home: 21, q3Away: 17, current: { home: 21, away: 17 }, q3: { home: 21, away: 17 },
            q1: { home: 7, away: 3 },
            half: { home: 14, away: 10 },
            period: 3, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'IN_PROGRESS'
        });
        await delay(1000);
        await simulatePoolGame(poolId, {
            finalHome: 28, finalAway: 24, current: { home: 28, away: 24 }, final: { home: 28, away: 24 },
            q1: { home: 7, away: 3 },
            half: { home: 14, away: 10 },
            q3: { home: 21, away: 17 },
            period: 4, clock: '0:00', startTime: new Date().toISOString(), gameStatus: 'FINAL'
        });
        addStep('Simulate Game', 'success', 'Game simulation complete. Final Score: 28-24');
    }

    // E. Verify Winners and Capture Final State
    await delay(4000); // Wait for Cloud Function triggers to process winners
    addStep('Verification', 'success', 'Fetching final pool state for validation...');

    // Attempt to fetch the final pool state to return to the AI Validator
    try {
        const finalPool = await dbService.getPoolById(poolId);
        const winners = await dbService.getWinners(poolId);

        const winnerDetails = winners.map((w: any) => `${w.period}: ${w.owner} ($${w.amount})`).join(', ');
        const totalPayout = winners.reduce((sum: number, w: any) => sum + (w.amount || 0), 0);

        addStep('Verification', 'success', `Validation Data: Found ${winners.length} winner records.`);
        addStep('Verification', 'success', `Winner Details: [${winnerDetails}]`);
        addStep('Verification', 'success', `Total Payout Distributed: $${totalPayout}`);
        addStep('Verification', 'success', `Final Pool Status: ${finalPool?.scores?.gameStatus || 'UNKNOWN'}`);

        return {
            poolId,
            simulationComplete: true,
            finalStatus: 'FINAL',
            finalPoolData: finalPool,
            winners: winners
        };
    } catch (e) {
        addStep('Verification', 'failed', 'Could not fetch final pool state for validation.', e);
        return {
            poolId,
            simulationComplete: true,
            finalStatus: 'FINAL',
            error: 'Could not fetch final data'
        };
    }
}

async function runPartialFillScenario(
    poolId: string,
    addStep: (step: string, status: 'success' | 'failed' | 'skipped', message: string, data?: any) => void
) {
    addStep('Reserve Squares', 'success', 'Reserving 50 squares (Partial Fill)');
    const testUsers = generateTestUsers(5);
    const squareIds = Array.from({ length: 50 }, (_, i) => i); // First 50 only

    let processed = 0;
    for (const user of testUsers) {
        const mySquares = squareIds.slice(processed, processed + 10);
        await Promise.all(mySquares.map(sqId =>
            dbService.reserveSquare(poolId, sqId, { name: user.name, email: user.email }, undefined, user.name)
        ));
        processed += 10;
    }

    addStep('Lock Pool', 'success', 'Locking partially filled pool');
    await dbService.lockPool(poolId);

    addStep('Simulate Game', 'success', 'Simulating game...');
    await simulatePoolGame(poolId, { q1Home: 0, q1Away: 0, finalHome: 0, finalAway: 0 }); // 0-0 game
}
