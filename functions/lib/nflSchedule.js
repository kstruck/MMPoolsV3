"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.importNFLSchedule = exports.lockNFLSpreadsJob = exports.syncNFLScoresJob = void 0;
exports.fetchNFLWeekSchedule = fetchNFLWeekSchedule;
exports.importNFLSeason = importNFLSeason;
const admin = __importStar(require("firebase-admin"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const audit_1 = require("./audit");
// Safe integer parsing helper
const safeInt = (val) => {
    if (val === null || val === undefined)
        return 0;
    const parsed = parseInt(val);
    return isNaN(parsed) ? 0 : parsed;
};
/**
 * Fetch a weekly NFL schedule from the official ESPN Scoreboard API.
 * seasonType: 1 = Preseason, 2 = Regular Season, 3 = Postseason
 */
async function fetchNFLWeekSchedule(week, season, seasonType) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    try {
        let url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&season=${season}&seasontype=${seasonType}`;
        try {
            // 1. Fetch calendar to extract precise date range for the specified week of 2026 season.
            // This prevents ESPN's scoreboard API from falling back to 2025 games during the off-season.
            const calendarUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}`;
            const calendarResp = await fetch(calendarUrl);
            if (calendarResp.ok) {
                const calendarData = await calendarResp.json();
                const calendar = ((_b = (_a = calendarData.leagues) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.calendar) || [];
                const segment = calendar.find((c) => String(c.value) === String(seasonType));
                if (segment && segment.entries) {
                    // Map week index securely to segment entries
                    const entry = segment.entries[week - 1];
                    if (entry && entry.startDate && entry.endDate) {
                        const start = new Date(entry.startDate);
                        const end = new Date(entry.endDate);
                        const formatDate = (d) => {
                            const y = d.getUTCFullYear();
                            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
                            const day = String(d.getUTCDate()).padStart(2, '0');
                            return `${y}${m}${day}`;
                        };
                        const dateQuery = `${formatDate(start)}-${formatDate(end)}`;
                        url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateQuery}`;
                        console.log(`[nflSchedule] Resolved Week ${week} (Type: ${seasonType}) to dates: ${dateQuery}`);
                    }
                }
            }
        }
        catch (calErr) {
            console.warn("[nflSchedule] Failed to resolve dates via calendar, falling back to standard week scoreboard URL:", calErr);
        }
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`ESPN Scoreboard API returned HTTP status ${resp.status}`);
        }
        const data = await resp.json();
        if (!data.events || !Array.isArray(data.events)) {
            return [];
        }
        const games = [];
        for (const event of data.events) {
            const competition = (_c = event.competitions) === null || _c === void 0 ? void 0 : _c[0];
            if (!competition)
                continue;
            const competitors = competition.competitors || [];
            const homeComp = competitors.find((c) => c.homeAway === 'home');
            const awayComp = competitors.find((c) => c.homeAway === 'away');
            if (!homeComp || !awayComp)
                continue;
            const gameId = `espn_${event.id}`;
            const startTime = new Date(competition.date || event.date).getTime();
            const statusType = ((_e = (_d = event.status) === null || _d === void 0 ? void 0 : _d.type) === null || _e === void 0 ? void 0 : _e.state) || 'pre';
            const status = statusType === 'post' ? 'FINAL' : statusType === 'in' ? 'IN_PROGRESS' : 'SCHEDULED';
            // Check if this is a Monday Night Football game (MNF) - usually Monday in US, which starts after UTC Monday night or Tuesday early
            const startDateObj = new Date(startTime);
            const isMonday = startDateObj.getDay() === 1; // 1 = Monday
            let spreadValue = 0;
            let spreadFound = false;
            if (competition.odds && competition.odds[0]) {
                const odds = competition.odds[0];
                if (odds.details && odds.details !== 'EVEN') {
                    // e.g. "BAL -3.5" or "KC -10"
                    const parts = odds.details.split(' ');
                    if (parts.length >= 2) {
                        const favAbbr = parts[0];
                        const spreadPoints = parseFloat(parts[1]);
                        if (!isNaN(spreadPoints)) {
                            spreadFound = true;
                            // If favored team is HOME, spread relative to home is negative (e.g. -3.5).
                            // If favored team is AWAY, spread relative to home is positive (e.g. +3.5).
                            if (((_f = homeComp.team) === null || _f === void 0 ? void 0 : _f.abbreviation) === favAbbr) {
                                spreadValue = spreadPoints; // e.g. -3.5
                            }
                            else {
                                spreadValue = -spreadPoints; // e.g. +3.5
                            }
                        }
                    }
                }
                else if (odds.details === 'EVEN') {
                    spreadFound = true;
                    spreadValue = 0;
                }
            }
            games.push(Object.assign({ id: gameId, espnGameId: event.id, week: week, season: season, seasonType: seasonType, homeTeam: {
                    id: ((_g = homeComp.team) === null || _g === void 0 ? void 0 : _g.id) || '',
                    name: ((_h = homeComp.team) === null || _h === void 0 ? void 0 : _h.name) || ((_j = homeComp.team) === null || _j === void 0 ? void 0 : _j.displayName) || 'Home Team',
                    abbreviation: ((_k = homeComp.team) === null || _k === void 0 ? void 0 : _k.abbreviation) || 'HOME',
                    logoUrl: ((_l = homeComp.team) === null || _l === void 0 ? void 0 : _l.logo) || ''
                }, awayTeam: {
                    id: ((_m = awayComp.team) === null || _m === void 0 ? void 0 : _m.id) || '',
                    name: ((_o = awayComp.team) === null || _o === void 0 ? void 0 : _o.name) || ((_p = awayComp.team) === null || _p === void 0 ? void 0 : _p.displayName) || 'Away Team',
                    abbreviation: ((_q = awayComp.team) === null || _q === void 0 ? void 0 : _q.abbreviation) || 'AWAY',
                    logoUrl: ((_r = awayComp.team) === null || _r === void 0 ? void 0 : _r.logo) || ''
                }, scores: status !== 'SCHEDULED' ? {
                    home: safeInt(homeComp.score),
                    away: safeInt(awayComp.score)
                } : undefined, startTime: startTime, status: status, clock: ((_s = event.status) === null || _s === void 0 ? void 0 : _s.displayClock) || '0:00', period: safeInt((_t = event.status) === null || _t === void 0 ? void 0 : _t.period), isMonday: isMonday }, (spreadFound ? { spread: { value: spreadValue, locked: false } } : {})));
        }
        return games;
    }
    catch (err) {
        console.error(`[nflSchedule] fetchNFLWeekSchedule failed for week ${week}, season ${season}:`, err);
        return [];
    }
}
/**
 * Bulk import a full season (or specific week) of NFL games into Firestore.
 */
async function importNFLSeason(season, seasonType, weeks = Array.from({ length: 18 }, (_, i) => i + 1)) {
    const db = admin.firestore();
    let importedCount = 0;
    console.log(`[nflSchedule] Starting import of season ${season} (type: ${seasonType}) for weeks: ${weeks.join(', ')}`);
    // Auto-cleanup any existing/legacy games for this season and seasonType to prevent orphan/mismatched data
    try {
        const existingSnap = await db.collection('nfl_games')
            .where('season', '==', season)
            .where('seasonType', '==', seasonType)
            .get();
        if (!existingSnap.empty) {
            console.log(`[nflSchedule] Found ${existingSnap.size} existing matching games for season ${season} (type ${seasonType}). Cleaning up...`);
            const deleteBatch = db.batch();
            existingSnap.docs.forEach(doc => {
                deleteBatch.delete(doc.ref);
            });
            await deleteBatch.commit();
            console.log(`[nflSchedule] Cleaned up ${existingSnap.size} legacy matching games successfully.`);
        }
    }
    catch (cleanupErr) {
        console.warn("[nflSchedule] Failed to clean up legacy matching games in DB:", cleanupErr);
    }
    for (const week of weeks) {
        const games = await fetchNFLWeekSchedule(week, season, seasonType);
        if (games.length === 0) {
            console.log(`[nflSchedule] No games fetched for Week ${week}. Skipping.`);
            continue;
        }
        const batch = db.batch();
        for (const game of games) {
            const cleanedGame = JSON.parse(JSON.stringify(game));
            const gameRef = db.collection('nfl_games').doc(cleanedGame.id);
            batch.set(gameRef, cleanedGame, { merge: true });
            importedCount++;
        }
        await batch.commit();
        console.log(`[nflSchedule] Week ${week} imported successfully with ${games.length} games.`);
    }
    await (0, audit_1.writeAuditEvent)({
        poolId: 'system',
        type: 'POOL_STATUS_CHANGED', // Closest system type
        message: `Imported ${importedCount} NFL games for ${season} (type: ${seasonType})`,
        severity: 'INFO',
        actor: { uid: 'system', role: 'SYSTEM', label: 'NFL Scheduler' }
    });
    return { success: true, importedCount };
}
/**
 * Scheduled sync function that fetches active NFL schedules and scores,
 * updates game statuses in Firestore, and updates kickoff times (schedule flexing).
 */
exports.syncNFLScoresJob = (0, scheduler_1.onSchedule)('*/5 * * * *', async (event) => {
    var _a;
    const db = admin.firestore();
    const now = Date.now();
    // Find games that are either in progress, final but not synced/completed in scoring,
    // or scheduled to start soon (within next 2 hours or in the last 12 hours)
    const activeGamesSnap = await db.collection('nfl_games')
        .where('startTime', '<=', now + 2 * 60 * 60 * 1000) // starts in next 2 hours
        .get();
    if (activeGamesSnap.empty) {
        return;
    }
    // Group active games by season and week to batch API requests
    const weeksToSync = new Map();
    activeGamesSnap.forEach(doc => {
        const data = doc.data();
        // Only fetch if game status is not FINAL, or if it was recently finalised
        if (data.status !== 'FINAL' || (data.status === 'FINAL' && data.startTime > now - 24 * 60 * 60 * 1000)) {
            const key = `${data.season}_${data.seasonType}_${data.week}`;
            if (!weeksToSync.has(key)) {
                weeksToSync.set(key, { week: data.week, season: data.season, seasonType: data.seasonType });
            }
        }
    });
    if (weeksToSync.size === 0) {
        return;
    }
    console.log(`[nflSchedule] Syncing active scores for ${weeksToSync.size} week slots`);
    for (const [_, slot] of weeksToSync) {
        const freshGames = await fetchNFLWeekSchedule(slot.week, slot.season, slot.seasonType);
        if (freshGames.length === 0)
            continue;
        const batch = db.batch();
        for (const freshGame of freshGames) {
            const gameRef = db.collection('nfl_games').doc(freshGame.id);
            const existingDoc = activeGamesSnap.docs.find(d => d.id === freshGame.id);
            if (existingDoc) {
                const existingData = existingDoc.data();
                // Check for schedule flexing (startTime changed)
                if (existingData.startTime !== freshGame.startTime) {
                    console.log(`[nflSchedule] Flex scheduling detected for game ${freshGame.id}: ${new Date(existingData.startTime).toLocaleTimeString()} -> ${new Date(freshGame.startTime).toLocaleTimeString()}`);
                    await (0, audit_1.writeAuditEvent)({
                        poolId: 'system',
                        type: 'SCHEDULE_FLEX',
                        message: `NFL Flex Schedule: Game ${freshGame.awayTeam.abbreviation} @ ${freshGame.homeTeam.abbreviation} moved from ${new Date(existingData.startTime).toISOString()} to ${new Date(freshGame.startTime).toISOString()}`,
                        severity: 'INFO',
                        actor: { uid: 'system', role: 'SYSTEM', label: 'NFL Score Sync' },
                        payload: { gameId: freshGame.id, oldTime: existingData.startTime, newTime: freshGame.startTime }
                    });
                }
                if (((_a = existingData.spread) === null || _a === void 0 ? void 0 : _a.locked) && freshGame.spread) {
                    // Retain the locked spread value and state
                    freshGame.spread = {
                        value: existingData.spread.value,
                        locked: true
                    };
                }
            }
            const cleanedGame = JSON.parse(JSON.stringify(freshGame));
            batch.set(gameRef, cleanedGame, { merge: true });
        }
        await batch.commit();
    }
});
const https_1 = require("firebase-functions/v2/https");
/**
 * Scheduled job to lock NFL spreads every Tuesday at 9:00 AM EST.
 * Scans upcoming games, and if spread is available, marks it as locked.
 */
exports.lockNFLSpreadsJob = (0, scheduler_1.onSchedule)({
    schedule: '0 9 * * 2', // 9:00 AM every Tuesday
    timeZone: 'America/New_York'
}, async () => {
    const db = admin.firestore();
    const now = Date.now();
    // Find games starting in the next 7 days that are not finalized
    const upcomingSnap = await db.collection('nfl_games')
        .where('startTime', '>', now)
        .where('startTime', '<=', now + 7 * 24 * 60 * 60 * 1000)
        .get();
    if (upcomingSnap.empty)
        return;
    const batch = db.batch();
    let lockedCount = 0;
    upcomingSnap.forEach(doc => {
        const data = doc.data();
        // Lock spread if it's available and not already locked
        if (data.spread && !data.spread.locked) {
            if (data.spread.value !== undefined) {
                batch.update(doc.ref, {
                    'spread.locked': true
                });
                lockedCount++;
            }
        }
    });
    if (lockedCount > 0) {
        await batch.commit();
        console.log(`[lockNFLSpreadsJob] Locked spreads for ${lockedCount} upcoming games.`);
    }
});
/**
 * SuperAdmin-only HTTPS callable to trigger manual NFL schedule imports.
 */
exports.importNFLSchedule = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const userRole = request.auth.token.role || 'USER';
    if (userRole !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Only super admins can trigger NFL schedule imports.');
    }
    const data = request.data || {};
    const season = data.season ? String(data.season) : '2026';
    const seasonType = data.seasonType !== undefined ? parseInt(String(data.seasonType)) : 2;
    const weeks = data.weeks ? (Array.isArray(data.weeks) ? data.weeks.map(Number) : [Number(data.weeks)]) : Array.from({ length: 18 }, (_, i) => i + 1);
    try {
        const res = await importNFLSeason(season, seasonType, weeks);
        return { success: true, importedCount: res.importedCount };
    }
    catch (err) {
        console.error("importNFLSchedule Failure:", err);
        throw new https_1.HttpsError('internal', `Failed to import NFL schedule: ${err.message || 'Unknown error'}`, err);
    }
});
//# sourceMappingURL=nflSchedule.js.map