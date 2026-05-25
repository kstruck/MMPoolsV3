"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scorePickemEntry = scorePickemEntry;
exports.validateConfidenceValues = validateConfidenceValues;
exports.evaluateSurvivorWeek = evaluateSurvivorWeek;
exports.updateSurvivorStatus = updateSurvivorStatus;
exports.checkAutoSurviveExemption = checkAutoSurviveExemption;
exports.scoreMarginWeek = scoreMarginWeek;
exports.sortMarginLeaderboard = sortMarginLeaderboard;
// ============================================================================
// Pick'em Scoring Logic
// ============================================================================
/**
 * Scores a Weekly Pick'em participant's entry for a single week or the season.
 */
function scorePickemEntry(entry, games, pool) {
    var _a, _b, _c, _d, _e, _f;
    let points = 0;
    let correctCount = 0;
    const confidenceMode = pool.settings.confidenceMode;
    for (const game of games) {
        if (game.status !== 'FINAL' && game.status !== 'CANCELLED')
            continue;
        const pick = entry.picks[game.id];
        if (!pick)
            continue; // Unpicked game
        // Voids cancelled games (earn 0)
        if (game.status === 'CANCELLED')
            continue;
        // Check if the picked team won
        const homeScore = (_b = (_a = game.scores) === null || _a === void 0 ? void 0 : _a.home) !== null && _b !== void 0 ? _b : 0;
        const awayScore = (_d = (_c = game.scores) === null || _c === void 0 ? void 0 : _c.away) !== null && _d !== void 0 ? _d : 0;
        let isCorrect = false;
        if (homeScore > awayScore && pick === game.homeTeam.abbreviation) {
            isCorrect = true;
        }
        else if (awayScore > homeScore && pick === game.awayTeam.abbreviation) {
            isCorrect = true;
        }
        else if (homeScore === awayScore) {
            // Ties usually count as 0 or ties in standard pools. We treat tie as incorrect for straight pick'em unless specified.
            isCorrect = false;
        }
        if (isCorrect) {
            correctCount++;
            if (confidenceMode) {
                const confidenceVal = (_f = (_e = entry.confidence) === null || _e === void 0 ? void 0 : _e[game.id]) !== null && _f !== void 0 ? _f : 0;
                points += confidenceVal;
            }
            else {
                points += 1; // Standard scoring
            }
        }
    }
    return { points, correctCount };
}
/**
 * Validates confidence assignments for a given week.
 * N = number of games. Range must be uniquely [17-N..16].
 */
function validateConfidenceValues(picks, confidence, gamesInWeek) {
    const N = gamesInWeek.length;
    const minVal = 17 - N;
    const maxVal = 16;
    const gameIds = new Set(gamesInWeek.map(g => g.id));
    const assignedValues = new Set();
    for (const gameId of Object.keys(picks)) {
        if (!gameIds.has(gameId))
            continue; // Not a game in this week
        const value = confidence[gameId];
        if (value === undefined || value === null) {
            return { valid: false, error: `INCOMPLETE_CONFIDENCE_SUBMISSION: Missing confidence value for game ${gameId}` };
        }
        if (value < minVal || value > maxVal) {
            return { valid: false, error: `OUT_OF_RANGE_CONFIDENCE: Value ${value} must be between ${minVal} and ${maxVal}` };
        }
        if (assignedValues.has(value)) {
            return { valid: false, error: `DUPLICATE_CONFIDENCE_VALUES: Value ${value} assigned more than once` };
        }
        assignedValues.add(value);
    }
    // Completeness check
    if (assignedValues.size !== N) {
        return { valid: false, error: `INCOMPLETE_CONFIDENCE_SUBMISSION: Must assign confidence to all ${N} games` };
    }
    return { valid: true };
}
// ============================================================================
// Survivor Scoring Logic
// ============================================================================
/**
 * Evaluates whether a Survivor entry survived the given week.
 * Returns { survived: boolean, strikeLogged: boolean }
 */
function evaluateSurvivorWeek(entry, week, gamesInWeek, pool) {
    var _a, _b, _c, _d, _e;
    // If player is already eliminated, they stay eliminated unless rebuy was processed
    if (entry.status === 'ELIMINATED') {
        return { survived: false, strikeLogged: false };
    }
    // Check if player was exempt this week
    if ((_a = entry.exemptWeeks) === null || _a === void 0 ? void 0 : _a.includes(week)) {
        return { survived: true, strikeLogged: false };
    }
    const pick = entry.picks[week];
    // Auto-Strike for non-submission after games conclude
    if (!pick) {
        return { survived: false, strikeLogged: true };
    }
    // Find the game containing the picked team
    const game = gamesInWeek.find(g => g.homeTeam.abbreviation === pick || g.awayTeam.abbreviation === pick);
    // If game isn't found or was cancelled, we err on the side of safety
    if (!game) {
        return { survived: true, strikeLogged: false };
    }
    if (game.status === 'CANCELLED') {
        return { survived: true, strikeLogged: false }; // Cancelled game = survive
    }
    if (game.status !== 'FINAL') {
        return { survived: true, strikeLogged: false }; // Still active, skip for now
    }
    const homeScore = (_c = (_b = game.scores) === null || _b === void 0 ? void 0 : _b.home) !== null && _c !== void 0 ? _c : 0;
    const awayScore = (_e = (_d = game.scores) === null || _d === void 0 ? void 0 : _d.away) !== null && _e !== void 0 ? _e : 0;
    const isHome = game.homeTeam.abbreviation === pick;
    let teamWon = false;
    let teamLost = false;
    let teamTied = false;
    if (homeScore > awayScore) {
        if (isHome)
            teamWon = true;
        else
            teamLost = true;
    }
    else if (awayScore > homeScore) {
        if (!isHome)
            teamWon = true;
        else
            teamLost = true;
    }
    else {
        teamTied = true;
    }
    const pickLosersMode = pool.settings.pickLosersMode;
    let strike = false;
    if (pickLosersMode) {
        // Inverted: pick a loser to survive. Winning/Tying = strike
        if (teamWon || teamTied)
            strike = true;
    }
    else {
        // Standard: pick a winner to survive. Losing/Tying = strike
        if (teamLost || teamTied)
            strike = true;
    }
    return {
        survived: !strike,
        strikeLogged: strike
    };
}
/**
 * Evaluates the new status of a Survivor entry based on current strikes.
 */
function updateSurvivorStatus(entry, pool) {
    const freshEntry = Object.assign({}, entry);
    const maxStrikes = pool.settings.maxStrikes;
    if (freshEntry.strikesUsed >= maxStrikes + 1) {
        freshEntry.status = 'ELIMINATED';
    }
    else {
        freshEntry.status = 'ALIVE';
    }
    return freshEntry;
}
/**
 * Checks if a player qualifies for an auto-survive exemption (no eligible teams remaining).
 * Evaluates whether all NFL teams playing this week are either already used or on bye.
 */
function checkAutoSurviveExemption(usedTeams, gamesInWeek, autoSurviveEnabled) {
    if (!autoSurviveEnabled)
        return false;
    // Find all team abbreviations playing this week
    const teamsPlaying = new Set();
    for (const game of gamesInWeek) {
        if (game.status !== 'CANCELLED') {
            teamsPlaying.add(game.homeTeam.abbreviation);
            teamsPlaying.add(game.awayTeam.abbreviation);
        }
    }
    // Filter out teams that the player has already picked in past weeks
    const eligibleTeams = [...teamsPlaying].filter(t => !usedTeams.includes(t));
    // If there are zero eligible teams playing this week, they get an exemption!
    return eligibleTeams.length === 0 && teamsPlaying.size > 0;
}
// ============================================================================
// Margin Scoring Logic
// ============================================================================
/**
 * Scores a Margin participant's entry for a single week.
 * Returns the score differential (can be negative).
 */
function scoreMarginWeek(pick, // team picked e.g. "KC"
gamesInWeek) {
    var _a, _b, _c, _d;
    const game = gamesInWeek.find(g => g.homeTeam.abbreviation === pick || g.awayTeam.abbreviation === pick);
    if (!game || (game.status !== 'FINAL' && game.status !== 'CANCELLED')) {
        return null; // Not ready or unpicked
    }
    if (game.status === 'CANCELLED') {
        return 0; // Cancelled game
    }
    const homeScore = (_b = (_a = game.scores) === null || _a === void 0 ? void 0 : _a.home) !== null && _b !== void 0 ? _b : 0;
    const awayScore = (_d = (_c = game.scores) === null || _c === void 0 ? void 0 : _c.away) !== null && _d !== void 0 ? _d : 0;
    const isHome = game.homeTeam.abbreviation === pick;
    // Margin of victory (includes OT)
    return isHome ? (homeScore - awayScore) : (awayScore - homeScore);
}
/**
 * Ranks Margin pool entries using the strict 5-level tiebreaker cascade.
 * 1. Highest Season Total margin.
 * 2. Lowest Negative Burden (sum of absolute values of negative margins).
 * 3. Most Positive Weeks (score > 0).
 * 4. Highest Single-Week margin.
 * 5. Deterministic tie-break based on userId comparison.
 */
function sortMarginLeaderboard(entries) {
    return [...entries].sort((a, b) => {
        // 1. Season Total
        if (b.seasonTotal !== a.seasonTotal) {
            return b.seasonTotal - a.seasonTotal;
        }
        // 2. Lowest Negative Burden (lower is better)
        if (a.negativeBurden !== b.negativeBurden) {
            return a.negativeBurden - b.negativeBurden;
        }
        // 3. Most Positive Weeks
        if (b.positiveWeeks !== a.positiveWeeks) {
            return b.positiveWeeks - a.positiveWeeks;
        }
        // 4. Highest Single Week
        if (b.bestWeek !== a.bestWeek) {
            return b.bestWeek - a.bestWeek;
        }
        // 5. Tie-breaker fallback (deterministic UUID sorting)
        return a.ownerUid.localeCompare(b.ownerUid);
    });
}
//# sourceMappingURL=nflScoringEngine.js.map