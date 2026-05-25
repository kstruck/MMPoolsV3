"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importNFLSchedule = exports.syncNFLScoresJob = void 0;
exports.fetchNFLWeekSchedule = fetchNFLWeekSchedule;
exports.importNFLSeason = importNFLSeason;
const admin = require("firebase-admin");
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
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
            games.push({
                id: gameId,
                espnGameId: event.id,
                week: week,
                season: season,
                seasonType: seasonType,
                homeTeam: {
                    id: ((_f = homeComp.team) === null || _f === void 0 ? void 0 : _f.id) || '',
                    name: ((_g = homeComp.team) === null || _g === void 0 ? void 0 : _g.name) || ((_h = homeComp.team) === null || _h === void 0 ? void 0 : _h.displayName) || 'Home Team',
                    abbreviation: ((_j = homeComp.team) === null || _j === void 0 ? void 0 : _j.abbreviation) || 'HOME',
                    logoUrl: ((_k = homeComp.team) === null || _k === void 0 ? void 0 : _k.logo) || ''
                },
                awayTeam: {
                    id: ((_l = awayComp.team) === null || _l === void 0 ? void 0 : _l.id) || '',
                    name: ((_m = awayComp.team) === null || _m === void 0 ? void 0 : _m.name) || ((_o = awayComp.team) === null || _o === void 0 ? void 0 : _o.displayName) || 'Away Team',
                    abbreviation: ((_p = awayComp.team) === null || _p === void 0 ? void 0 : _p.abbreviation) || 'AWAY',
                    logoUrl: ((_q = awayComp.team) === null || _q === void 0 ? void 0 : _q.logo) || ''
                },
                scores: status !== 'SCHEDULED' ? {
                    home: safeInt(homeComp.score),
                    away: safeInt(awayComp.score)
                } : undefined,
                startTime: startTime,
                status: status,
                clock: ((_r = event.status) === null || _r === void 0 ? void 0 : _r.displayClock) || '0:00',
                period: safeInt((_s = event.status) === null || _s === void 0 ? void 0 : _s.period),
                isMonday: isMonday
            });
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
            }
            const cleanedGame = JSON.parse(JSON.stringify(freshGame));
            batch.set(gameRef, cleanedGame, { merge: true });
        }
        await batch.commit();
    }
});
const https_1 = require("firebase-functions/v2/https");
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