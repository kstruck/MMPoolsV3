// Unauthenticated preview of the redesigned dashboards with mock data, for visual review
// only (route: /dev/dashboards). Not linked anywhere; safe to leave — renders the real
// components with fabricated props so the design can be seen without prod login.
import React, { useState } from 'react';
import type { Pool, User, NFLGame, WeeklyRecap } from '../types';
import { GlobalCommissionerDashboard } from '../components/Dashboards/GlobalCommissionerDashboard';
import { NFLUserBentoDashboard } from '../components/NFLPoolDashboard/NFLUserBentoDashboard';
import { NFLPoolRules } from '../components/NFLPoolDashboard/NFLPoolRules';

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

const mockEntries = [
  { id: 'demo', ownerUid: 'demo', userName: 'Kevin Struck', totalScore: 34, paidStatus: 'PAID', picks: { g0: 'SEA' } },
  { id: 'u1', ownerUid: 'u1', userName: 'Sarah K.', totalScore: 41, paidStatus: 'PAID' },
  { id: 'u2', ownerUid: 'u2', userName: 'Mark S.', totalScore: 38, paidStatus: 'UNPAID' },
  { id: 'u3', ownerUid: 'u3', userName: 'Alex R.', totalScore: 29, paidStatus: 'PAID' },
];

const homepagePool = mkPool('hp', "Kevin's 2026 NFL Weekly Pick'em", 'NFL_PICKEM', 24, 20);
(homepagePool as any).seasonType = 1;
(homepagePool as any).settings = { entryFee: 20, confidenceMode: false, lockMode: 'PER_GAME' };

const noop = () => {};

export const DevDashboardPreview: React.FC = () => {
  const [view, setView] = useState<'hub' | 'homepage' | 'rules'>('hub');
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
          </div>
        </div>

        {view === 'hub' ? (
          <GlobalCommissionerDashboard user={mockUser} managedPools={mockPools} />
        ) : view === 'rules' ? (
          <NFLPoolRules pool={homepagePool} isManager={true} onEditRules={noop} lockTime={seasonOpen} />
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
            onBack={noop}
            onOpenAuth={noop}
            isManager={true}
            onSelectTab={noop}
          />
        )}
      </div>
    </div>
  );
};

export default DevDashboardPreview;
