// Marketing demo of the Player Profile with a season-and-a-half of dummy data
// (route: /dev/profile-demo). Unauthenticated, mock-only, not linked in nav —
// exists so a realistic screenshot can be taken before real season data accrues.
// TODO(kevin): DELETE this file + its App.tsx route once marketing screenshots are
// taken — target removal 2026-08-01. Until then: noindex + visible demo banner
// (banner sits above the profile so the screenshot crop excludes it).
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { PlayerProfile } from './PlayerProfile';

// Deterministic pseudo-random (fixed seed) so the screenshot is reproducible.
const rand = (() => {
  let s = 42;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
})();

const TEAMS = ['KC', 'BUF', 'SF', 'PHI', 'DAL', 'BAL', 'CIN', 'MIA', 'DET', 'GB', 'NYJ', 'NE', 'SEA', 'LAR', 'MIN', 'PIT'];

const weekly: any[] = [];
const siteWeekly: any[] = [];
const pickHistory: any[] = [];

const seasons: Array<[string, number]> = [['2025', 18], ['2026', 7]];
for (const [season, weeks] of seasons) {
  for (let w = 1; w <= weeks; w++) {
    const total = 16;
    const correct = 8 + Math.floor(rand() * 6); // 8..13 — a good-but-human player
    weekly.push({ season, week: w, correct, total, points: correct });
    siteWeekly.push({ season, week: w, avgAccuracy: 55 + Math.floor(rand() * 8), players: 87 });
    // A few graded picks per week for the history tab
    for (let g = 0; g < 3; g++) {
      const home = TEAMS[Math.floor(rand() * TEAMS.length)];
      let away = TEAMS[Math.floor(rand() * TEAMS.length)];
      if (away === home) away = TEAMS[(TEAMS.indexOf(home) + 1) % TEAMS.length];
      const pick = rand() > 0.5 ? home : away;
      const roll = rand();
      pickHistory.push({
        season, week: w, gameId: `demo_${season}_${w}_${g}`,
        awayAbbr: away, homeAbbr: home, pick,
        result: roll > 0.42 ? 'W' : roll > 0.06 ? 'L' : 'PUSH',
        poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT',
      });
    }
  }
}
pickHistory.reverse();

const sumCorrect = weekly.reduce((s, w) => s + w.correct, 0);
const sumTotal = weekly.reduce((s, w) => s + w.total, 0);

const demoProfile = {
  uid: 'demo-player',
  userName: 'Jordan Miller',
  subjectKind: 'PLAYER',
  schemaVersion: 1,
  overall: {
    accuracy: Math.round((sumCorrect / sumTotal) * 100),
    correct: sumCorrect,
    total: sumTotal,
    points: sumCorrect,
    poolsEntered: 5,
    seasonsPlayed: 2,
  },
  weekly,
  yearly: [
    { season: '2026', correct: weekly.filter(w => w.season === '2026').reduce((s, w) => s + w.correct, 0), total: 7 * 16, accuracy: 66, profitNet: null, bestFinish: { rank: 3, totalEntries: 24 } },
    { season: '2025', correct: weekly.filter(w => w.season === '2025').reduce((s, w) => s + w.correct, 0), total: 18 * 16, accuracy: 65, profitNet: 240, bestFinish: { rank: 1, totalEntries: 21 } },
  ],
  teamByTeam: [
    {
      poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT',
      teams: [
        { team: 'KC', wins: 14, losses: 3, pushes: 0, accuracy: 82 },
        { team: 'SF', wins: 12, losses: 4, pushes: 1, accuracy: 75 },
        { team: 'BAL', wins: 10, losses: 4, pushes: 0, accuracy: 71 },
        { team: 'DET', wins: 9, losses: 5, pushes: 0, accuracy: 64 },
        { team: 'BUF', wins: 8, losses: 6, pushes: 1, accuracy: 57 },
        { team: 'DAL', wins: 5, losses: 8, pushes: 0, accuracy: 38 },
        { team: 'NYJ', wins: 2, losses: 7, pushes: 0, accuracy: 22 },
      ],
    },
    {
      poolType: 'NFL_PICKEM', pickMode: 'ATS',
      teams: [
        { team: 'PHI', wins: 7, losses: 3, pushes: 1, accuracy: 70 },
        { team: 'MIA', wins: 5, losses: 4, pushes: 0, accuracy: 56 },
        { team: 'NE', wins: 3, losses: 6, pushes: 1, accuracy: 33 },
      ],
    },
    {
      poolType: 'NFL_SURVIVOR',
      teams: [
        { team: 'KC', wins: 2, losses: 0, pushes: 0, accuracy: 100 },
        { team: 'DET', wins: 2, losses: 0, pushes: 0, accuracy: 100 },
        { team: 'GB', wins: 1, losses: 1, pushes: 0, accuracy: 50 },
      ],
    },
  ],
  pickHistory,
  profit: { won: 465, feesOwed: 145, net: 320, poolsPendingPayouts: 1, feesEstimated: false },
  achievements: [
    { id: 'a1', code: 'PERFECT_WEEK', title: 'Perfect Week', description: 'Went 16-0 in Week 12, 2025', iconKey: 'trophy', tier: 'GOLD', earnedAt: 1765000000000, season: '2025', schemaVersion: 1 },
    { id: 'a2', code: 'POOL_CHAMPION', title: 'Pool Champion', description: 'Won a season-long pool outright', iconKey: 'crown', tier: 'GOLD', earnedAt: 1768000000000, season: '2025', schemaVersion: 1 },
    { id: 'a3', code: 'HOT_STREAK', title: 'Hot Streak', description: '4 straight winning weeks above 70%', iconKey: 'flame', tier: 'SILVER', earnedAt: 1763000000000, season: '2025', schemaVersion: 1 },
    { id: 'a4', code: 'SURVIVOR_ELITE', title: 'Final Five', description: 'Among the last 5 alive in a 40-player Survivor pool', iconKey: 'shield', tier: 'BRONZE', earnedAt: 1766000000000, season: '2025', schemaVersion: 1 },
  ],
  siteAverages: { kind: 'SITE_AVERAGES', weekly: siteWeekly, profilesCounted: 87 },
};

export const DevProfileDemo: React.FC = () => (
  <>
    <Helmet>
      <meta name="robots" content="noindex, nofollow" />
      <title>Demo Profile (fictional data)</title>
    </Helmet>
    <div className="bg-gold-600 text-navy-950 text-center text-xs font-display font-bold uppercase tracking-[0.08em] py-1.5">
      Demo profile — fictional player and data, for illustration only
    </div>
    <PlayerProfile previewData={demoProfile} />
  </>
);

export default DevProfileDemo;
