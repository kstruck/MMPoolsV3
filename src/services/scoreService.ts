import type { Scores, GameState } from '../types';

export const fetchGameScore = async (gameState: GameState): Promise<{ scores: Partial<Scores>, status: string } | null> => {
  try {
    // Determine League Path
    const leaguePath = gameState.league === 'college' || gameState.league === 'ncaa' ? 'college-football' : 'nfl';

    let url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/scoreboard`;
    if (gameState.gameId) {
      url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/summary?event=${gameState.gameId}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    let matchedGame: any = null;

    if (gameState.gameId) {
      if (data.header) {
        // Fix: Check for status inside competitions if not on header
        const comp = data.header.competitions?.[0];
        matchedGame = {
          competitions: data.header.competitions,
          status: data.header.status || comp?.status,
          shortName: data.header.name || "Game"
        };
      } else {
        matchedGame = data.events?.find((e: any) => e.id === gameState.gameId);
      }
    } else {
      const games = data.events || [];
      const poolHome = gameState.homeTeam.toLowerCase();
      const poolAway = gameState.awayTeam.toLowerCase();
      matchedGame = games.find((g: any) => {
        const competitions = g.competitions || [];
        if (competitions.length === 0) return false;
        const competitors = competitions[0].competitors;
        if (!competitors || competitors.length < 2) return false;

        const team1 = competitors[0].team;
        const team2 = competitors[1].team;
        const names = [
          team1.displayName.toLowerCase(), team1.name.toLowerCase(), team1.abbreviation.toLowerCase(),
          team2.displayName.toLowerCase(), team2.name.toLowerCase(), team2.abbreviation.toLowerCase()
        ];
        return names.some((n: string) => n.includes(poolHome)) && names.some((n: string) => n.includes(poolAway));
      });
    }

    // Robust check for missing game or missing status
    if (!matchedGame || !matchedGame.status) {
      return null;
    }

    const competition = matchedGame.competitions?.[0];
    if (!competition) return null;

    const competitors = competition.competitors;
    const apiHomeComp = competitors.find((c: any) => c.homeAway === 'home');
    const apiAwayComp = competitors.find((c: any) => c.homeAway === 'away');

    if (!apiHomeComp || !apiAwayComp) return null;

    // Helper to prevent NaN
    const safeInt = (val: any) => {
      if (val === null || val === undefined) return 0;
      const parsed = parseInt(val);
      return isNaN(parsed) ? 0 : parsed;
    };

    const homeLines = apiHomeComp.linescores || [];
    const awayLines = apiAwayComp.linescores || [];

    // Robust Helper to find score by period number
    // ESPN API format: { period: 1, value: 7, ... } or implied order
    const getPeriodScore = (lines: any[], p: number) => {
      let val;
      // 1. Try finding by period property (loose equality for string/number match)
      const found = lines.find((l: any) => l.period == p);
      if (found) {
        val = found.value ?? found.displayValue;
      } else {
        // 2. Fallback to index (ESPN linescores are ordered)
        const indexed = lines[p - 1];
        if (indexed) val = indexed.value ?? indexed.displayValue;
      }
      return safeInt(val);
    };

    // 1. Calculate Individual Quarter Scores
    const q1Home = getPeriodScore(homeLines, 1);
    const q1Away = getPeriodScore(awayLines, 1);

    const q2Home = getPeriodScore(homeLines, 2);
    const q2Away = getPeriodScore(awayLines, 2);

    const q3HomeRaw = getPeriodScore(homeLines, 3);
    const q3AwayRaw = getPeriodScore(awayLines, 3);

    const q4HomeRaw = getPeriodScore(homeLines, 4);
    const q4AwayRaw = getPeriodScore(awayLines, 4);

    // 2. Calculate Cumulative Scores (The "Grid Logic")
    // Halftime = Q1 + Q2
    const halfHome = q1Home + q2Home;
    const halfAway = q1Away + q2Away;

    // Q3 Cumulative = Halftime + Q3
    const q3Home = halfHome + q3HomeRaw;
    const q3Away = halfAway + q3AwayRaw;

    // Regulation Final = Q3 Cumulative + Q4
    const regFinalHome = q3Home + q4HomeRaw;
    const regFinalAway = q3Away + q4AwayRaw;

    // 3. Determine "Final" Score based on Settings
    const apiTotalHome = safeInt(apiHomeComp.score);
    const apiTotalAway = safeInt(apiAwayComp.score);

    let finalHome, finalAway;

    if (gameState.includeOvertime) {
      // Default: Use the total game score (includes OT)
      finalHome = apiTotalHome;
      finalAway = apiTotalAway;
    } else {
      // Variation: Strict Regulation Only
      finalHome = regFinalHome;
      finalAway = regFinalAway;
    }

    // Use optional chaining for safe access
    const statusState = matchedGame.status.type?.state;
    const period = safeInt(matchedGame.status.period);
    const completed = matchedGame.status.type?.completed;

    // Sanitize fields to prevent Firestore "undefined" errors
    const clock = matchedGame.status.displayClock || "0:00";
    // Fallback: Check competition date if main event date is missing
    const date = matchedGame.date || competition.date || null;

    const newScores: Partial<Scores> = {
      current: { home: apiTotalHome, away: apiTotalAway },
      gameStatus: statusState as 'pre' | 'in' | 'post',
      clock: clock,
      period: period,
      startTime: date
    };

    // Update state based on game progress
    // Note: We use >= logic to ensure scores persist after the period ends
    if (period >= 2 || statusState === 'post') newScores.q1 = { home: q1Home, away: q1Away };
    if (period >= 3 || statusState === 'post') newScores.half = { home: halfHome, away: halfAway };
    if (period >= 4 || statusState === 'post') newScores.q3 = { home: q3Home, away: q3Away };

    // Final is set when game is over OR if we are in OT and treating it as live final
    if (statusState === 'post' || completed) {
      newScores.final = { home: finalHome, away: finalAway };
    } else {
      newScores.final = null;
    }

    return { scores: newScores, status: matchedGame.shortName || 'Game' };

  } catch (e) {
    console.error("Score fetch failed", e);
    return null;
  }
};