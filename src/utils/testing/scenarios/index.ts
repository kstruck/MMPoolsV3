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
    field?: string; // poolStatus / profileField target
    userName?: string; // NFL assertions target an entry by user name
    week?: number; // NFL weekly assertions / recap checks
    gameKey?: string; // per-week game key ("g1"...) for gradedPick / consensusTally
    message: string;
}

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
};

export const SCENARIO_LIST = Object.values(SCENARIOS);

export function getScenarioById(id: string): TestScenario | undefined {
    return SCENARIOS[id];
}
