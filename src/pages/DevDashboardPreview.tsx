// Unauthenticated preview of the redesigned dashboards with mock data, for visual review
// only (route: /dev/dashboards). Not linked anywhere; safe to leave — renders the real
// components with fabricated props so the design can be seen without prod login.
import React from 'react';
import type { Pool, User } from '../types';
import { GlobalCommissionerDashboard } from '../components/Dashboards/GlobalCommissionerDashboard';

const mkPool = (id: string, name: string, type: string, players: number, fee: number, status = 'OPEN'): Pool => ({
  id,
  name,
  type,
  status,
  ownerId: 'demo',
  managerUid: 'demo',
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
  id: 'demo',
  name: 'Kevin Struck',
  role: 'COMMISSIONER',
  commissionerAggregate: {
    poolsManaged: 7,
    totalParticipants: 267,
    duesExpected: 4130,
    duesCollected: 2870,
    totalPayouts: 1250,
  },
} as unknown as User;

export const DevDashboardPreview: React.FC = () => (
  <div className="min-h-screen bg-page text-[color:var(--text)] p-6 md:p-10">
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold uppercase tracking-[0.05em]">Commissioner Hub — redesign preview</h1>
        <p className="text-muted text-sm font-body">Mock data. Route: <code>/dev/dashboards</code>. Not linked in nav.</p>
      </div>
      <GlobalCommissionerDashboard user={mockUser} managedPools={mockPools} />
    </div>
  </div>
);

export default DevDashboardPreview;
