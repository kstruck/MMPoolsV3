import type { Scores, GameState } from '../types';

export const fetchGameScore = async (gameState: GameState): Promise<{ scores: Partial<Scores>, status: string } | null> => {
  try {
    let url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
    if (gameState.gameId) {
      url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameState.gameId}`;
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

    // Safely calculate cumulative scores
    const q1Home = safeInt(homeLines[0]?.value);
    const q1Away = safeInt(awayLines[0]?.value);

    const q2Home = safeInt(homeLines[1]?.value);
    const q2Away = safeInt(awayLines[1]?.value);
    const halfHome = q1Home + q2Home;
    const halfAway = q1Away + q2Away;

    const q3HomeRaw = safeInt(homeLines[2]?.value);
    const q3AwayRaw = safeInt(awayLines[2]?.value);
    const q3Home = halfHome + q3HomeRaw;
    const q3Away = halfAway + q3AwayRaw;

    const finalHome = safeInt(apiHomeComp.score);
    const finalAway = safeInt(apiAwayComp.score);

    // Use optional chaining for safe access
    const statusState = matchedGame.status.type?.state;
    const period = safeInt(matchedGame.status.period);
    const completed = matchedGame.status.type?.completed;

    const newScores: Partial<Scores> = {
      current: { home: finalHome, away: finalAway }
    };

    if (period >= 2 || statusState === 'post') newScores.q1 = { home: q1Home, away: q1Away };
    if (period >= 3 || statusState === 'post') newScores.half = { home: halfHome, away: halfAway };
    if (period >= 4 || statusState === 'post') newScores.q3 = { home: q3Home, away: q3Away };
    if (statusState === 'post' || (period === 4 && completed)) newScores.final = { home: finalHome, away: finalAway };

    return { scores: newScores, status: matchedGame.shortName || 'Game' };

  } catch (e) {
    console.error("Score fetch failed", e);
    return null;
  }
};