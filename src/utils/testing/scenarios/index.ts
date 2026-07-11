// Pre-defined Test Scenarios - Index
// Exports all available test scenarios for the UI dropdown

import basicQuarters from './basic-quarters.json';
import everyScoreWins from './every-score-wins.json';
import partialFill from './partial-fill.json';
import propsBasic from './props-basic.json';
import bracketBasic from './bracket-basic.json';
import playoffBasic from './playoff-basic.json';
import playoffLifecycle from './playoff-lifecycle.json';
import bracketFibonacci from './bracket-fibonacci.json';
import bracketCustom from './bracket-custom.json';
import bracketMaxScore from './bracket-max-score.json';
import bracketEspn from './bracket-espn.json';
import bracketTiebreaker from './bracket-tiebreaker.json';
import bracketIncomplete from './bracket-incomplete.json';
import bracketZeroCorrect from './bracket-zero-correct.json';
import bracketE2EFullTournament from './bracket-e2e-full-tournament.json';
import nflPickemBasic from './nfl-pickem-basic.json';
import nflSurvivorBasic from './nfl-survivor-basic.json';
import nflMarginBasic from './nfl-margin-basic.json';
// PLAN-NFL-SIM-HARNESS Phase 4 (item 25) — matrix combination cells
import nflPickemStraightWeekly from './nfl-pickem-straight-weekly.json';
import nflPickemStraightHybrid from './nfl-pickem-straight-hybrid.json';
import nflPickemStraightConf from './nfl-pickem-straight-conf.json';
import nflPickemConfWeekly from './nfl-pickem-conf-weekly.json';
import nflPickemConfHybrid from './nfl-pickem-conf-hybrid.json';
import nflPickemAts from './nfl-pickem-ats.json';
import nflPickemAtsWeekly from './nfl-pickem-ats-weekly.json';
import nflPickemAtsHybrid from './nfl-pickem-ats-hybrid.json';
import nflPickemAtsConf from './nfl-pickem-ats-conf.json';
import nflPickemAtsConfWeekly from './nfl-pickem-ats-conf-weekly.json';
import nflPickemAtsConfHybrid from './nfl-pickem-ats-conf-hybrid.json';
// Phase 4 — hand-authored edge scenarios (expectations human-verified)
import nflPickemAtsPush from './nfl-pickem-ats-push.json';
import nflPickemTiePush from './nfl-pickem-tie-push.json';
import nflPickemMissedPicks from './nfl-pickem-missed-picks.json';
import nflPickemTiebreakerWeek from './nfl-pickem-tiebreaker-week.json';
import nflPickemDualMnf from './nfl-pickem-dual-mnf.json';
import nflPickemCancelledVoid from './nfl-pickem-cancelled-void.json';
import nflPickemPreseason from './nfl-pickem-preseason.json';
import nflPickemLockPergame from './nfl-pickem-lock-pergame.json';
import nflPickemLockWeekly from './nfl-pickem-lock-weekly.json';
import nflSurvivorStrikes2 from './nfl-survivor-strikes2.json';
import nflSurvivorPicklosers from './nfl-survivor-picklosers.json';
import nflSurvivorPickloserStrikes2 from './nfl-survivor-picklosers-strikes2.json';
import nflSurvivorAutosurvive from './nfl-survivor-autosurvive.json';
import nflSurvivorAutosurviveOff from './nfl-survivor-autosurvive-off.json';
import nflSurvivorTieStrike from './nfl-survivor-tie-strike.json';
import nflSurvivorMissedPick from './nfl-survivor-missed-pick.json';
import nflSurvivorAllEliminated from './nfl-survivor-all-eliminated.json';
import nflSurvivorDuplicateTeam from './nfl-survivor-duplicate-team.json';
import nflSurvivorRebuy from './nfl-survivor-rebuy.json';
import nflSurvivorRebuyLimits from './nfl-survivor-rebuy-limits.json';
import nflSurvivorLastMan from './nfl-survivor-last-man.json';
import nflSurvivorCancelledVoid from './nfl-survivor-cancelled-void.json';
import nflMarginWeekly from './nfl-margin-weekly.json';
import nflMarginHybrid from './nfl-margin-hybrid.json';
import nflMarginTieZero from './nfl-margin-tie-zero.json';
import nflMarginMissedPick from './nfl-margin-missed-pick.json';
import nflMarginSeasonTiebreak from './nfl-margin-season-tiebreak.json';
import nflMarginDuplicateTeam from './nfl-margin-duplicate-team.json';
// Phase 4 — buy-flow interaction (item 15: stamps only, never the paid path)
import nflBuyflowFreeLaunch from './nfl-buyflow-free-launch.json';
import nflBuyflowFreeCap from './nfl-buyflow-free-cap.json';
import nflBuyflowTrialStamp from './nfl-buyflow-trial-stamp.json';

export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS'
    | 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';

export interface TestAssertion {
    type: 'winnerCount' | 'winnerCountAtLeast' | 'winnerExists' | 'totalPayout' | 'poolStatus'
    | 'propCardCount' | 'propWinner' | 'propTopScore'
    | 'bracketEntryCount' | 'bracketWinner' | 'bracketTopScore' | 'maxScoreAtLeast'
    | 'playoffEntryCount' | 'playoffWinner'
    // NFL season pools (entries/recaps hydrated by nflSeasonSimulator)
    | 'nflEntryCount' | 'nflTotalScore' | 'nflWeeklyPoints' | 'nflWinner'
    | 'survivorStatus' | 'survivorStrikes'
    | 'marginSeasonTotal' | 'marginRank'
    | 'recapExists' | 'recapClosestTiebreaker'
    // PLAN-NFL-SIM-HARNESS Phase 1.10 — values match the PERSISTED schemas exactly
    // (weeklyResults games record, standings projection, seasonHistory, payoutRecords):
    | 'gradedPick'          // userName+week+gameKey -> expected W|L|PUSH|VOID (pickem) / SURVIVED|STRUCK|VOID (survivor)
    | 'standingsRow'        // userName -> expected subset of the type-specific standings/current row
    | 'seasonHistoryRow'    // userName -> expected subset of users/{uid}/seasonHistory/{poolId}
    | 'payoutRecordExists'  // userName (+ expected amount) in pools/{id}/payoutRecords
    | 'profileField'        // userName + field path -> expected value on publicProfiles/{uid}
    | 'consensusTally'      // gameKey -> expected {away,home,total} pool-consensus tally
    | 'submitRejected';     // userName+week -> expected error-code substring from the REAL submit path
    expected?: number | string | boolean | Record<string, unknown>;
    period?: string;
    digits?: [number, number];
    field?: string; // poolStatus / profileField target (dotted paths supported)
    userName?: string; // NFL assertions target an entry by user name
    week?: number; // NFL weekly assertions / recap checks
    gameKey?: string; // per-week game key ("g1"...) for gradedPick / consensusTally
    message: string;
}

/**
 * Real-path lifecycle operation (PLAN-NFL-SIM-HARNESS Phase 4, item 25).
 * When a scenario carries `lifecycleOps`, the runner executes them IN ORDER
 * after the direct-write entries (if any) land — driving the REAL guarded
 * callables (simJoinMembers / simSubmitPicks / simExecuteRebuy /
 * simFinalizePool / recordPoolPayouts / scoreNFLWeek). An op with
 * `expectError` MUST fail with a message containing that substring; the
 * outcome is recorded and asserted via the `submitRejected` assertion type.
 * `scoreWeeks` is ignored when lifecycleOps are present — ops drive scoring.
 */
export type LifecycleOp =
    | { op: 'join'; userNames: string[]; expectError?: string }
    | {
        op: 'submit'; userName: string; week: number;
        /** Pick'em: per-week gameKey -> team. Survivor/Margin: use `team`. */
        picks?: Record<string, string>;
        confidence?: Record<string, number>;
        team?: string;
        tiebreaker?: number;
        expectError?: string;
    }
    | { op: 'rebuy'; userName: string; week: number; expectError?: string }
    | { op: 'score'; week: number }
    /** Full replacement of the run's seeded games (same ordering contract as
     *  nflGames — index N stays doc gN+1); used to conclude games mid-scenario. */
    | { op: 'reseedGames'; games: ScenarioNFLGame[] }
    | { op: 'finalize'; expectError?: string }
    | { op: 'recordPayouts'; awards: Array<{ userName: string; amount: number; place: number }> };

// Synthetic NFL game in a scenario. Games are addressable in picks by PER-WEEK
// 1-based ordinal: "g1" = the first game OF THAT WEEK (picks are already keyed
// by week, so keys never collide across weeks — Codex R1#5). The simulator
// translates (week, gN) to the run's real seed-order sim- doc IDs.
export interface ScenarioNFLGame {
    week: number;
    home: string; // team abbreviation, e.g. "KC"
    away: string;
    homeScore?: number;
    awayScore?: number;
    status?: 'FINAL' | 'IN_PROGRESS' | 'SCHEDULED' | 'CANCELLED'; // default FINAL
    isMonday?: boolean;
    spread?: number; // relative to home (negative = home favored); locked at seed
    // Kickoff relative to run start, ms (negative = already kicked off). Default
    // -24h so score-only fixtures behave as before; lock-timing Golden Scenarios
    // set future offsets to exercise pre/post-lock submission (Codex R2#3).
    startOffsetMs?: number;
}

export interface TestScenario {
    id: string;
    name: string;
    description: string;
    poolType?: PoolType; // Default: SQUARES
    isE2E?: boolean; // If true, uses E2E simulator instead of standard simulator
    poolConfig: {
        name: string;
        type: string;
        costPerSquare?: number;
        cost?: number; // For props
        maxPlayers?: number;
        maxCards?: number; // For props
        ruleVariations?: Record<string, unknown>;
        scoringSystem?: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        entryFee?: number;
    };
    // E2E-specific configuration
    e2eConfig?: {
        entryCount?: number;
        scoringSystem?: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        customScoring?: number[];
        chalkBias?: number;
        seed?: number;
        includePerfectBracket?: boolean;
        includeControlEntries?: boolean;
    };
    squareCount?: number; // Default 100 (SQUARES only)
    testUsers?: Array<{
        name: string;
        strategy: string;
    }>;
    scoreUpdates?: Array<{
        period: string;
        homeScore: number;
        awayScore: number;
    }>;
    // Props-specific
    questions?: Array<{
        id: string;
        text: string;
        options: string[];
        points?: number;
    }>;
    testEntries?: Array<{
        userName: string;
        answers?: Record<string, number>; // Props
        rankings?: Record<string, number>; // Playoff
        picks?: Record<string, string>; // Bracket
        tiebreaker?: number; // Props
        tiebreakerVal?: number; // Playoff (standardize?)
        tiebreakerPrediction?: number; // Bracket
        // NFL Pick'em: week -> gameKey ("g1"...) -> team abbreviation
        pickemPicks?: Record<string, Record<string, string>>;
        // NFL Pick'em confidence: week -> gameKey -> value
        confidence?: Record<string, Record<string, number>>;
        // NFL Pick'em: week -> MNF combined-score prediction
        weeklyTiebreakers?: Record<string, number>;
        // NFL Survivor / Margin: week -> team abbreviation
        survivorPicks?: Record<string, string>;
        marginPicks?: Record<string, string>;
        usedTeams?: string[]; // Survivor pre-seeded history
    }>;
    grading?: Record<string, number>;
    assertions: TestAssertion[];
    tournamentResults?: unknown; // Bracket results
    roundResults?: unknown; // Playoff round results
    // NFL season pools: synthetic games (seeded via simSeedNFLGames) + which
    // weeks to score via the real scoreNFLWeek callable, in order.
    nflGames?: ScenarioNFLGame[];
    scoreWeeks?: number[];
    // Real-path lifecycle ops (Phase 4 item 25) — see LifecycleOp above.
    lifecycleOps?: LifecycleOp[];
    // Buy-flow scenarios only: the emulator runner must create the pool via the
    // REAL createNFLPool callable (billing launch-mode stamps live there) instead
    // of a direct doc seed. The browser simulator always creates via callable.
    createViaCallable?: boolean;
    // Deterministic full-season generation (PLAN-NFL-SIM-HARNESS Phase 1.12).
    // When present, games + testEntries are MATERIALIZED from @shared/simGen
    // (same seed ⇒ identical fixture, browser and emulator alike); any
    // hand-authored nflGames/testEntries must be absent.
    generator?: {
        seed: number;
        weeks: number;
        entryCount: number;
        gamesPerWeek?: number;
        strategies?: Array<'favorites' | 'random' | 'contrarian'>;
    };
}

export const SCENARIOS: Record<string, TestScenario> = {
    'basic-quarters': basicQuarters as unknown as TestScenario,
    'every-score-wins': everyScoreWins as unknown as TestScenario,
    'partial-fill': partialFill as unknown as TestScenario,
    'props-basic': propsBasic as unknown as TestScenario,
    'bracket-basic': bracketBasic as unknown as TestScenario,
    'playoff-basic': playoffBasic as unknown as TestScenario,
    'playoff-lifecycle': playoffLifecycle as unknown as TestScenario,
    'bracket-fibonacci': bracketFibonacci as unknown as TestScenario,
    'bracket-custom': bracketCustom as unknown as TestScenario,
    'bracket-max-score': bracketMaxScore as unknown as TestScenario,
    'bracket-espn': bracketEspn as unknown as TestScenario,
    'bracket-tiebreaker': bracketTiebreaker as unknown as TestScenario,
    'bracket-incomplete': bracketIncomplete as unknown as TestScenario,
    'bracket-zero-correct': bracketZeroCorrect as unknown as TestScenario,
    'bracket-e2e-full-tournament': bracketE2EFullTournament as unknown as TestScenario,
    'nfl-pickem-basic': nflPickemBasic as unknown as TestScenario,
    'nfl-survivor-basic': nflSurvivorBasic as unknown as TestScenario,
    'nfl-margin-basic': nflMarginBasic as unknown as TestScenario,
    'nfl-pickem-straight-weekly': nflPickemStraightWeekly as unknown as TestScenario,
    'nfl-pickem-straight-hybrid': nflPickemStraightHybrid as unknown as TestScenario,
    'nfl-pickem-straight-conf': nflPickemStraightConf as unknown as TestScenario,
    'nfl-pickem-conf-weekly': nflPickemConfWeekly as unknown as TestScenario,
    'nfl-pickem-conf-hybrid': nflPickemConfHybrid as unknown as TestScenario,
    'nfl-pickem-ats': nflPickemAts as unknown as TestScenario,
    'nfl-pickem-ats-weekly': nflPickemAtsWeekly as unknown as TestScenario,
    'nfl-pickem-ats-hybrid': nflPickemAtsHybrid as unknown as TestScenario,
    'nfl-pickem-ats-conf': nflPickemAtsConf as unknown as TestScenario,
    'nfl-pickem-ats-conf-weekly': nflPickemAtsConfWeekly as unknown as TestScenario,
    'nfl-pickem-ats-conf-hybrid': nflPickemAtsConfHybrid as unknown as TestScenario,
    'nfl-pickem-ats-push': nflPickemAtsPush as unknown as TestScenario,
    'nfl-pickem-tie-push': nflPickemTiePush as unknown as TestScenario,
    'nfl-pickem-missed-picks': nflPickemMissedPicks as unknown as TestScenario,
    'nfl-pickem-tiebreaker-week': nflPickemTiebreakerWeek as unknown as TestScenario,
    'nfl-pickem-dual-mnf': nflPickemDualMnf as unknown as TestScenario,
    'nfl-pickem-cancelled-void': nflPickemCancelledVoid as unknown as TestScenario,
    'nfl-pickem-preseason': nflPickemPreseason as unknown as TestScenario,
    'nfl-pickem-lock-pergame': nflPickemLockPergame as unknown as TestScenario,
    'nfl-pickem-lock-weekly': nflPickemLockWeekly as unknown as TestScenario,
    'nfl-survivor-strikes2': nflSurvivorStrikes2 as unknown as TestScenario,
    'nfl-survivor-picklosers': nflSurvivorPicklosers as unknown as TestScenario,
    'nfl-survivor-picklosers-strikes2': nflSurvivorPickloserStrikes2 as unknown as TestScenario,
    'nfl-survivor-autosurvive': nflSurvivorAutosurvive as unknown as TestScenario,
    'nfl-survivor-autosurvive-off': nflSurvivorAutosurviveOff as unknown as TestScenario,
    'nfl-survivor-tie-strike': nflSurvivorTieStrike as unknown as TestScenario,
    'nfl-survivor-missed-pick': nflSurvivorMissedPick as unknown as TestScenario,
    'nfl-survivor-all-eliminated': nflSurvivorAllEliminated as unknown as TestScenario,
    'nfl-survivor-duplicate-team': nflSurvivorDuplicateTeam as unknown as TestScenario,
    'nfl-survivor-rebuy': nflSurvivorRebuy as unknown as TestScenario,
    'nfl-survivor-rebuy-limits': nflSurvivorRebuyLimits as unknown as TestScenario,
    'nfl-survivor-last-man': nflSurvivorLastMan as unknown as TestScenario,
    'nfl-survivor-cancelled-void': nflSurvivorCancelledVoid as unknown as TestScenario,
    'nfl-margin-weekly': nflMarginWeekly as unknown as TestScenario,
    'nfl-margin-hybrid': nflMarginHybrid as unknown as TestScenario,
    'nfl-margin-tie-zero': nflMarginTieZero as unknown as TestScenario,
    'nfl-margin-missed-pick': nflMarginMissedPick as unknown as TestScenario,
    'nfl-margin-season-tiebreak': nflMarginSeasonTiebreak as unknown as TestScenario,
    'nfl-margin-duplicate-team': nflMarginDuplicateTeam as unknown as TestScenario,
    'nfl-buyflow-free-launch': nflBuyflowFreeLaunch as unknown as TestScenario,
    'nfl-buyflow-free-cap': nflBuyflowFreeCap as unknown as TestScenario,
    'nfl-buyflow-trial-stamp': nflBuyflowTrialStamp as unknown as TestScenario,
};

export const SCENARIO_LIST = Object.values(SCENARIOS);

export function getScenarioById(id: string): TestScenario | undefined {
    return SCENARIOS[id];
}
