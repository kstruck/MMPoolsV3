import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * PLAN-PAYMENT-LEDGER T5 (D3/D4/D5, K3/K11/K12) — the commissioner ledger is
 * wired to the two callables and never invents a figure. Root vitest has no
 * DOM, so these are comment-stripped wiring guards.
 */
describe('PaymentLedgerNFL — wiring (T5)', () => {
  const ledger = code('src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx');
  it('is mounted on the NFL manager view beside (not instead of) Record Payouts, and owns the fee toggle', () => {
    const mgr = code('src/components/NFLPoolDashboard/NFLManagerView.tsx');
    expect(mgr).toContain("import { PaymentLedgerNFL } from './PaymentLedgerNFL'");
    expect(mgr).toContain('<PaymentLedgerNFL pool={pool} members={members} entries={entries} onTogglePaid={handleTogglePayment} onSettleRebuys={handleSettleRebuys} savingFeeUid={isSavingPayment} />');
    expect(mgr).toContain('<RecordPayoutsCard pool={pool} entries={entries} />');
    // The roster card is picks / remind / co-comm only — the fee toggle moved INTO the ledger (Kevin, 2026-08-16).
    expect(mgr).not.toMatch(/onClick=\{\(\) => handleTogglePayment\(row\.uid/);
    // "View full ledger" on the Overview and "Open Payment Ledger" on the member Payments tab both land on it.
    expect(mgr).toContain("onOpenLedger={() => setCommishTab('members')}");
    const dash = code('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
    expect(dash).toContain("onManagePayments={() => setActiveTab('manager', 'members')}");
    expect(dash).toContain("initialSection={searchParams.get('section')}");
    const bento = code('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');
    expect(bento).toContain('onClick={onOpenLedger}');
    expect(bento).not.toContain('Advanced Payment Ledger');
  });
  it('is one spreadsheet: a column per scored week, fee paid checkbox, totals', () => {
    expect(ledger).toContain('nflWeekChip(seasonType, week)');
    expect(ledger).toContain("aria-label={`${r.name} entry fee paid`}");
    expect(ledger).toContain('onTogglePaid?.(r.uid, r.paidStatus');
    expect(ledger).toMatch(/Owed in[\s\S]*Paid in[\s\S]*Owed out[\s\S]*Paid out/);
    // Weeks scored before weekly prizes existed name the fix (rescore), not a bare empty state.
    expect(ledger).toContain('scored before weekly prizes existed');
    expect(ledger).toContain('Score Week');
  });
  it('reads ONLY published recap prizes (weeklyPlaces × weeklyPrize) — never re-ranks or re-prices', () => {
    expect(ledger).toContain('recap.weeklyPlaces');
    expect(ledger).toContain('recap.weeklyPrize');
    expect(ledger).not.toMatch(/rankWeeklyPlaces|splitPrizes|priceWeeklyPlaces|potBreakdown|perWeekPrizePot/);
  });
  it('the checkbox RECORDS a weekly PLACE award (entryId + week, settled) — K3: nothing is recorded until ticked', () => {
    expect(ledger).toContain("kind: 'PLACE', place: r.rank, week: r.week, settled: checked }]");
    expect(ledger).toContain('dbService.recordPoolPayouts(pool.id');
    expect(ledger).toContain('dbService.setPayoutSettled(pool.id, r.live.id, checked)');
  });
  it('a live award that no longer matches the recap is STALE and re-records via staleAwardId (K12)', () => {
    expect(ledger).toContain('Number(live.amount) !== p.prize || Number(live.place) !== p.rank');
    expect(ledger).toContain('staleAwardId: r.live.id');
    // A correction is not a payment: settlement carries over from the replaced record (codex r3 on T5).
    expect(ledger).toContain('settled: wasSettled, staleAwardId: r.live.id');
    expect(ledger).toContain('STALE');
  });
  it('fee status comes from the Member Record; the WRITER (setPaidStatus) stays in NFLManagerView and arrives as a prop', () => {
    expect(ledger).toContain('buildPoolRoster({ pool, members, entries })');
    expect(ledger).toContain("r.paidStatus === 'PAID'");
    expect(ledger).not.toContain('setPaidStatus');
    expect(ledger).not.toContain('updateEntryPayment');
  });
  it('dbService exposes the private-record subscription the ledger needs', () => {
    expect(code('src/services/dbService.ts')).toContain('subscribeToPayoutRecordsPrivate:');
  });
});
