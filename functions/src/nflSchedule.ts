import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { writeAuditEvent } from './audit';
import { NFLGame } from './types';

// Safe integer parsing helper
const safeInt = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const parsed = parseInt(val);
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Map an ESPN status to our NFLGame status. ESPN `type.state` is only pre/in/post,
 * so canceled/postponed/suspended must be read from `type.name` (e.g. STATUS_CANCELED).
 * A canceled game must NOT map to FINAL (it would score 0-0); a postponed/suspended game
 * stays SCHEDULED (won't score) and self-heals when ESPN reschedules it. Pure + testable.
 */
export function mapEspnGameStatus(
  state: string | undefined,
  name: string | undefined,
): 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'CANCELLED' {
  const n = (name || '').toUpperCase();
  if (n.includes('CANCEL') || n.includes('FORFEIT')) return 'CANCELLED';
  if (n.includes('POSTPONED') || n.includes('DELAYED') || n.includes('SUSPENDED')) return 'SCHEDULED';
  if (state === 'post') return 'FINAL';
  if (state === 'in') return 'IN_PROGRESS';
  return 'SCHEDULED';
}

/**
 * Fetch a weekly NFL schedule from the official ESPN Scoreboard API.
 * seasonType: 1 = Preseason, 2 = Regular Season, 3 = Postseason
 */
export async function fetchNFLWeekSchedule(
  week: number,
  season: string,
  seasonType: 1 | 2 | 3
): Promise<NFLGame[]> {
  try {
    let url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&season=${season}&seasontype=${seasonType}`;

    try {
      // 1. Fetch calendar to extract precise date range for the specified week of 2026 season.
      // This prevents ESPN's scoreboard API from falling back to 2025 games during the off-season.
      const calendarUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}`;
      const calendarResp = await fetch(calendarUrl);
      if (calendarResp.ok) {
        const calendarData = await calendarResp.json();
        const calendar = calendarData.leagues?.[0]?.calendar || [];
        const segment = calendar.find((c: any) => String(c.value) === String(seasonType));
        if (segment && segment.entries) {
          // Map week index securely to segment entries
          const entry = segment.entries[week - 1];
          if (entry && entry.startDate && entry.endDate) {
            const start = new Date(entry.startDate);
            const end = new Date(entry.endDate);
            
            const formatDate = (d: Date) => {
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
    } catch (calErr) {
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

    const games: NFLGame[] = [];

    for (const event of data.events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const competitors = competition.competitors || [];
      const homeComp = competitors.find((c: any) => c.homeAway === 'home');
      const awayComp = competitors.find((c: any) => c.homeAway === 'away');

      if (!homeComp || !awayComp) continue;

      const gameId = `espn_${event.id}`;
      const startTime = new Date(competition.date || event.date).getTime();
      const status = mapEspnGameStatus(event.status?.type?.state, event.status?.type?.name);

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
              if (homeComp.team?.abbreviation === favAbbr) {
                spreadValue = spreadPoints; // e.g. -3.5
              } else {
                spreadValue = -spreadPoints; // e.g. +3.5
              }
            }
          }
        } else if (odds.details === 'EVEN') {
          spreadFound = true;
          spreadValue = 0;
        }
      }

      games.push({
        id: gameId,
        espnGameId: event.id,
        week: week,
        season: season,
        seasonType: seasonType,
        homeTeam: {
          id: homeComp.team?.id || '',
          name: homeComp.team?.name || homeComp.team?.displayName || 'Home Team',
          abbreviation: homeComp.team?.abbreviation || 'HOME',
          logoUrl: homeComp.team?.logo || ''
        },
        awayTeam: {
          id: awayComp.team?.id || '',
          name: awayComp.team?.name || awayComp.team?.displayName || 'Away Team',
          abbreviation: awayComp.team?.abbreviation || 'AWAY',
          logoUrl: awayComp.team?.logo || ''
        },
        scores: status !== 'SCHEDULED' ? {
          home: safeInt(homeComp.score),
          away: safeInt(awayComp.score)
        } : undefined,
        startTime: startTime,
        status: status,
        clock: event.status?.displayClock || '0:00',
        period: safeInt(event.status?.period),
        isMonday: isMonday,
        ...(spreadFound ? { spread: { value: spreadValue, locked: false } } : {})
      });
    }

    return games;
  } catch (err) {
    console.error(`[nflSchedule] fetchNFLWeekSchedule failed for week ${week}, season ${season}:`, err);
    return [];
  }
}

/**
 * Bulk import a full season (or specific week) of NFL games into Firestore.
 */
export async function importNFLSeason(
  season: string,
  seasonType: 1 | 2 | 3,
  weeks: number[] = Array.from({ length: 18 }, (_, i) => i + 1)
): Promise<{ success: boolean; importedCount: number }> {
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
  } catch (cleanupErr) {
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

  await writeAuditEvent({
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
export const syncNFLScoresJob = onSchedule('*/5 * * * *', async (event) => {
  const db = admin.firestore();
  const now = Date.now();

  // Only games in the active window: started within the last 24h (still live or
  // recently final) through the next 2h. The lower bound stops the 5-minute job from
  // dragging the whole past season into every run (a single-field range is allowed).
  const activeGamesSnap = await db.collection('nfl_games')
    .where('startTime', '>=', now - 24 * 60 * 60 * 1000)
    .where('startTime', '<=', now + 2 * 60 * 60 * 1000)
    .get();

  if (activeGamesSnap.empty) {
    return;
  }

  // Group active games by season and week to batch API requests
  const weeksToSync = new Map<string, { week: number; season: string; seasonType: 1 | 2 | 3 }>();
  activeGamesSnap.forEach(doc => {
    const data = doc.data() as NFLGame;
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
    if (freshGames.length === 0) continue;

    const batch = db.batch();
    for (const freshGame of freshGames) {
      const gameRef = db.collection('nfl_games').doc(freshGame.id);
      const existingDoc = activeGamesSnap.docs.find(d => d.id === freshGame.id);

      if (existingDoc) {
        const existingData = existingDoc.data() as NFLGame;

        // Check for schedule flexing (startTime changed)
        if (existingData.startTime !== freshGame.startTime) {
          console.log(`[nflSchedule] Flex scheduling detected for game ${freshGame.id}: ${new Date(existingData.startTime).toLocaleTimeString()} -> ${new Date(freshGame.startTime).toLocaleTimeString()}`);
          
          await writeAuditEvent({
            poolId: 'system',
            type: 'SCHEDULE_FLEX',
            message: `NFL Flex Schedule: Game ${freshGame.awayTeam.abbreviation} @ ${freshGame.homeTeam.abbreviation} moved from ${new Date(existingData.startTime).toISOString()} to ${new Date(freshGame.startTime).toISOString()}`,
            severity: 'INFO',
            actor: { uid: 'system', role: 'SYSTEM', label: 'NFL Score Sync' },
            payload: { gameId: freshGame.id, oldTime: existingData.startTime, newTime: freshGame.startTime }
          });
        }
        if (existingData.spread?.locked && freshGame.spread) {
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

import { onCall, HttpsError } from 'firebase-functions/v2/https';

/**
 * Scheduled job to lock NFL spreads every Tuesday at 9:00 AM EST.
 * Scans upcoming games, and if spread is available, marks it as locked.
 */
export const lockNFLSpreadsJob = onSchedule({
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

  if (upcomingSnap.empty) return;

  const batch = db.batch();
  let lockedCount = 0;

  upcomingSnap.forEach(doc => {
    const data = doc.data() as NFLGame;
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
export const importNFLSchedule = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in.');
  }

  const userRole = request.auth.token.role || 'USER';
  if (userRole !== 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'Only super admins can trigger NFL schedule imports.');
  }

  const data = request.data || {};
  const season = data.season ? String(data.season) : '2026';
  const seasonType = data.seasonType !== undefined ? parseInt(String(data.seasonType)) as 1 | 2 | 3 : 2;
  const weeks = data.weeks ? (Array.isArray(data.weeks) ? data.weeks.map(Number) : [Number(data.weeks)]) : Array.from({ length: 18 }, (_, i) => i + 1);

  try {
    const res = await importNFLSeason(season, seasonType, weeks);
    return { success: true, importedCount: res.importedCount };
  } catch (err: any) {
    console.error("importNFLSchedule Failure:", err);
    throw new HttpsError('internal', `Failed to import NFL schedule: ${err.message || 'Unknown error'}`, err);
  }
});
