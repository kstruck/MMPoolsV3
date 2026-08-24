// Unauthenticated preview of the redesigned dashboards with mock data, for visual review
// only (route: /dev/dashboards). Not linked anywhere; safe to leave — renders the real
// components with fabricated props so the design can be seen without prod login.
import React, { useState } from 'react';
import type { Pool, User, NFLGame, WeeklyRecap } from '../types';
import { GlobalCommissionerDashboard } from '../components/Dashboards/GlobalCommissionerDashboard';
import { NFLUserBentoDashboard } from '../components/NFLPoolDashboard/NFLUserBentoDashboard';
import { NFLPoolRules } from '../components/NFLPoolDashboard/NFLPoolRules';
import { NFLManagerView } from '../components/NFLPoolDashboard/NFLManagerView';
import { PaymentsPanel } from '../components/PaymentsPanel';
import { PlayerProfile } from './PlayerProfile';

// Full ADR 0005 shape — aggregate-only, zero pool identifiers (matches shared/profile.ts).
const mockProfile = {
  uid: 'demo', userName: 'Kevin Struck', subjectKind: 'PLAYER', schemaVersion: 1,
  overall: { accuracy: 67, correct: 96, total: 144, points: 96, poolsEntered: 3, seasonsPlayed: 2 },
  weekly: [
    { season: '2026', week: 1, correct: 11, total: 16, points: 11 },
    { season: '2026', week: 2, correct: 9, total: 16, points: 9 },
    { season: '2026', week: 3, correct: 12, total: 16, points: 12 },
    { season: '2026', week: 4, correct: 13, total: 16, points: 13 },
    { season: '2026', week: 5, correct: 10, total: 16, points: 10 },
  ],
  yearly: [
    { season: '2026', correct: 55, total: 80, accuracy: 69, profitNet: null, bestFinish: { rank: 2, totalEntries: 24 } },
    { season: '2025', correct: 41, total: 64, accuracy: 64, profitNet: 130, bestFinish: { rank: 1, totalEntries: 18 } },
  ],
  teamByTeam: [
    {
      poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT',
      teams: [
        { team: 'KC', wins: 6, losses: 1, pushes: 0, accuracy: 86 },
        { team: 'SF', wins: 4, losses: 1, pushes: 1, accuracy: 80 },
        { team: 'DAL', wins: 2, losses: 4, pushes: 0, accuracy: 33 },
        { team: 'NYJ', wins: 0, losses: 2, pushes: 0, accuracy: 0 },
      ],
    },
    {
      poolType: 'NFL_SURVIVOR',
      teams: [
        { team: 'BUF', wins: 2, losses: 0, pushes: 0, accuracy: 100 },
        { team: 'PHI', wins: 1, losses: 1, pushes: 0, accuracy: 50 },
      ],
    },
  ],
  pickHistory: [
    { season: '2026', week: 5, gameId: 'g50', awayAbbr: 'KC', homeAbbr: 'BUF', pick: 'KC', result: 'L', poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT' },
    { season: '2026', week: 5, gameId: 'g51', awayAbbr: 'SF', homeAbbr: 'GB', pick: 'SF', result: 'W', poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT' },
    { season: '2026', week: 5, gameId: 'g52', awayAbbr: 'DAL', homeAbbr: 'PHI', pick: 'PHI', result: 'SURVIVED', poolType: 'NFL_SURVIVOR' },
    { season: '2026', week: 4, gameId: 'g40', awayAbbr: 'MIA', homeAbbr: 'NYJ', pick: 'MIA', result: 'W', poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT' },
    { season: '2026', week: 4, gameId: 'g41', awayAbbr: 'BAL', homeAbbr: 'CIN', pick: 'BAL', result: 'PUSH', poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT' },
    { season: '2026', week: 4, gameId: 'g42', awayAbbr: 'SEA', homeAbbr: 'LAR', pick: 'SEA', result: 'W', poolType: 'NFL_MARGIN', net: 7 },
  ],
  profit: { won: 250, feesOwed: 95, net: 155, poolsPendingPayouts: 1, feesEstimated: true },
  achievements: [
    { id: 'a1', code: 'PERFECT_WEEK', title: 'Perfect Week', description: 'Went 16-0 in a scored week', iconKey: 'trophy', tier: 'GOLD', earnedAt: 1760000000000, season: '2025', schemaVersion: 1 },
  ],
};

const mockExpertProfile = {
  uid: 'expert_espnFpi', userName: 'ESPN FPI', subjectKind: 'EXPERT', schemaVersion: 1,
  overall: { accuracy: 68, correct: 54, total: 80, points: 54, poolsEntered: 1, seasonsPlayed: 1 },
  weekly: [
    { season: '2026', week: 1, correct: 11, total: 16, points: 11 },
    { season: '2026', week: 2, correct: 10, total: 16, points: 10 },
    { season: '2026', week: 3, correct: 12, total: 16, points: 12 },
    { season: '2026', week: 4, correct: 11, total: 16, points: 11 },
    { season: '2026', week: 5, correct: 10, total: 16, points: 10 },
  ],
  yearly: [{ season: '2026', correct: 54, total: 80, accuracy: 68, profitNet: null, bestFinish: null }],
  teamByTeam: [
    {
      poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT',
      teams: [
        { team: 'KC', wins: 5, losses: 0, pushes: 0, accuracy: 100 },
        { team: 'CAR', wins: 1, losses: 3, pushes: 0, accuracy: 25 },
      ],
    },
  ],
  pickHistory: [
    { season: '2026', week: 5, gameId: 'g50', awayAbbr: 'KC', homeAbbr: 'BUF', pick: 'BUF', result: 'W', poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT' },
    { season: '2026', week: 5, gameId: 'g51', awayAbbr: 'SF', homeAbbr: 'GB', pick: 'SF', result: 'W', poolType: 'NFL_PICKEM', pickMode: 'STRAIGHT' },
  ],
  profit: null,
  achievements: [],
};

const mkPool = (id: string, name: string, type: string, players: number, fee: number, status = 'OPEN'): Pool => ({
  id, name, type, status, ownerId: 'demo', managerUid: 'demo',
  participantIds: Array.from({ length: players }, (_, i) => `u${i}`),
  settings: { entryFee: fee },
} as unknown as Pool);

const mockPools: Pool[] = [
  mkPool('p1', "Kevin's 2026 NFL Weekly Pick'em", 'NFL_PICKEM', 24, 20),
  mkPool('p2', 'Office Survivor League', 'NFL_SURVIVOR', 40, 25),
  mkPool('p3', 'Margin Masters', 'NFL_MARGIN', 12, 50),
  mkPool('p4', 'Super Bowl LX Squares', 'SQUARES', 100, 10),
  mkPool('p5', 'March Melee Official Bracket', 'BRACKET', 64, 15),
  mkPool('p6', 'Playoff Challenge 2026', 'NFL_PLAYOFFS', 18, 30),
  mkPool('p7', "Friends & Family Pick'em", 'NFL_PICKEM', 9, 0),
];

const mockUser: User = {
  id: 'demo', name: 'Kevin Struck', role: 'COMMISSIONER',
  commissionerAggregate: { poolsManaged: 7, totalParticipants: 267, duesExpected: 4130, duesCollected: 2870, totalPayouts: 1250 },
} as unknown as User;

// --- Pool Homepage (member bento) mock ---
const team = (id: string, name: string, abbr: string) => ({ id, name, abbreviation: abbr });
const HOUR = 3600_000;
const base = 1_760_000_000_000; // fixed epoch so the preview is deterministic
const g = (i: number, away: [string, string, string], home: [string, string, string], status: NFLGame['status'], extra: Partial<NFLGame> = {}): NFLGame => ({
  id: `g${i}`, espnGameId: `e${i}`, week: 1, season: '2026', seasonType: 1,
  awayTeam: team(...away), homeTeam: team(...home),
  startTime: base + i * HOUR, status, ...extra,
});

const mockGames: NFLGame[] = [
  g(0, ['ne', 'Patriots', 'NE'], ['sea', 'Seahawks', 'SEA'], 'IN_PROGRESS', { scores: { away: 14, home: 17 }, clock: '7:12', period: 3 }),
  g(1, ['dal', 'Cowboys', 'DAL'], ['phi', 'Eagles', 'PHI'], 'SCHEDULED'),
  g(2, ['bal', 'Ravens', 'BAL'], ['cin', 'Bengals', 'CIN'], 'SCHEDULED'),
  g(3, ['kc', 'Chiefs', 'KC'], ['buf', 'Bills', 'BUF'], 'SCHEDULED'),
  g(4, ['sf', '49ers', 'SF'], ['gb', 'Packers', 'GB'], 'FINAL', { scores: { away: 24, home: 20 } }),
  g(5, ['mia', 'Dolphins', 'MIA'], ['nyj', 'Jets', 'NYJ'], 'SCHEDULED'),
];

const wr = (a: number[][]) => Object.fromEntries(a.map(([w, c, t, p]) => [w, { correct: c, total: t, points: p }]));
const mockEntries = [
  { id: 'demo', ownerUid: 'demo', userName: 'Kevin Struck', totalScore: 34, paidStatus: 'PAID', picks: { g0: 'SEA' }, weeklyResults: wr([[1, 11, 16, 11], [2, 9, 16, 9], [3, 12, 16, 12]]) },
  { id: 'u1', ownerUid: 'u1', userName: 'Sarah K.', totalScore: 41, paidStatus: 'PAID', weeklyResults: wr([[1, 14, 16, 14], [2, 13, 16, 13], [3, 14, 16, 14]]) },
  { id: 'u2', ownerUid: 'u2', userName: 'Mark S.', totalScore: 38, paidStatus: 'UNPAID', weeklyResults: wr([[1, 12, 16, 12], [2, 13, 16, 13], [3, 13, 16, 13]]) },
  { id: 'u3', ownerUid: 'u3', userName: 'Alex R.', totalScore: 29, paidStatus: 'PAID', weeklyResults: wr([[1, 10, 16, 10], [2, 9, 16, 9], [3, 10, 16, 10]]) },
];

const homepagePool = mkPool('hp', "Kevin's 2026 NFL Weekly Pick'em", 'NFL_PICKEM', 24, 20);
(homepagePool as any).seasonType = 1;
(homepagePool as any).settings = { entryFee: 20, confidenceMode: false, lockMode: 'PER_GAME' };

// --- Roster / Payments mock: commissioner + a joined member have NO entry yet ---
const rosterPool = { id: 'rp', name: "Kevin's Pick'em", type: 'NFL_PICKEM', status: 'OPEN', ownerId: 'demo', managerUid: 'demo', seasonType: 1, participantIds: ['demo', 'u1', 'u2', 'u3', 'u5'], settings: { entryFee: 20 } } as unknown as Pool;
const rosterMembers = [
  { uid: 'demo', userName: 'Kevin Struck', paidStatus: 'UNPAID', role: 'MANAGER' },
  { uid: 'u1', userName: 'Sarah K.', paidStatus: 'PAID' },
  { uid: 'u2', userName: 'Mark S.', paidStatus: 'UNPAID' },
  { uid: 'u3', userName: 'Alex R.', paidStatus: 'PAID' },
  { uid: 'u5', userName: 'Dana P.', paidStatus: 'UNPAID' }, // joined, no entry
];
const rosterEntries = [
  { id: 'u1', ownerUid: 'u1', userName: 'Sarah K.', totalScore: 41, paidStatus: 'PAID', picks: { g0: 'SEA' } },
  { id: 'u2', ownerUid: 'u2', userName: 'Mark S.', totalScore: 38, paidStatus: 'UNPAID', picks: {} },
  { id: 'u3', ownerUid: 'u3', userName: 'Alex R.', totalScore: 29, paidStatus: 'PAID', picks: { g0: 'NE' } },
];

const noop = () => {};

export const DevDashboardPreview: React.FC = () => {
  const [view, setView] = useState<'hub' | 'homepage' | 'rules' | 'roster' | 'profile' | 'expert'>('hub');
  const [week, setWeek] = useState(1);
  const seasonOpen = 1_800_000_000_000; // fixed future epoch (Jan 2027) -> "editable until" state
  return (
    <div className="min-h-screen bg-page text-[color:var(--text)] p-6 md:p-10">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold uppercase tracking-[0.05em]">Dashboard redesign — preview</h1>
            <p className="text-muted text-sm font-body">Mock data. Route: <code>/dev/dashboards</code>. Not linked in nav.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView('hub')} className={`px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] border ${view === 'hub' ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border-gold-500/40' : 'bg-surface text-muted border-line'}`}>Commissioner Hub</button>
            <button onClick={() => setView('homepage')} className={`px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] border ${view === 'homepage' ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border-gold-500/40' : 'bg-surface text-muted border-line'}`}>Pool Homepage</button>
            <button onClick={() => setView('rules')} className={`px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] border ${view === 'rules' ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border-gold-500/40' : 'bg-surface text-muted border-line'}`}>Rules Tab</button>
            <button onClick={() => setView('roster')} className={`px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] border ${view === 'roster' ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border-gold-500/40' : 'bg-surface text-muted border-line'}`}>Payments / Roster</button>
            <button onClick={() => setView('profile')} className={`px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] border ${view === 'profile' ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border-gold-500/40' : 'bg-surface text-muted border-line'}`}>Player Profile</button>
            <button onClick={() => setView('expert')} className={`px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] border ${view === 'expert' ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border-gold-500/40' : 'bg-surface text-muted border-line'}`}>Expert Profile</button>
          </div>
        </div>

        {view === 'profile' ? (
          <PlayerProfile key="player" previewData={mockProfile} />
        ) : view === 'expert' ? (
          <PlayerProfile key="expert" previewData={mockExpertProfile} />
        ) : view === 'hub' ? (
          <GlobalCommissionerDashboard user={mockUser} managedPools={mockPools} />
        ) : view === 'rules' ? (
          <NFLPoolRules pool={homepagePool} isManager={true} onEditRules={noop} lockTime={seasonOpen} />
        ) : view === 'roster' ? (
          <div className="space-y-8">
            <div>
              <h2 className="text-sm font-display font-bold uppercase tracking-[0.12em] text-muted mb-3">Payments tab (member view + commissioner button)</h2>
              <PaymentsPanel pool={rosterPool} user={mockUser} entries={rosterEntries} members={rosterMembers} isManager={true} onManagePayments={() => setView('roster')} />
            </div>
            <div>
              <h2 className="text-sm font-display font-bold uppercase tracking-[0.12em] text-muted mb-3">Commissioner view — member roster (everyone who joined)</h2>
              <NFLManagerView pool={rosterPool} entries={rosterEntries} members={rosterMembers} games={mockGames} week={week} user={mockUser} onSelectTab={noop} />
            </div>
          </div>
        ) : (
          <NFLUserBentoDashboard
            pool={homepagePool}
            user={mockUser}
            games={mockGames}
            entries={mockEntries}
            recaps={[] as WeeklyRecap[]}
            selectedWeek={week}
            setSelectedWeek={setWeek}
            isWeekLocked={false}
            earliestGame={mockGames[0]}
            onSelectTab={noop}
          />
        )}
      </div>
    </div>
  );
};

export default DevDashboardPreview;
