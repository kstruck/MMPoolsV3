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
  it('is mounted on the NFL manager view beside (not instead of) Record Payouts', () => {
    const mgr = code('src/components/NFLPoolDashboard/NFLManagerView.tsx');
    expect(mgr).toContain("import { PaymentLedgerNFL } from './PaymentLedgerNFL'");
    expect(mgr).toContain('<PaymentLedgerNFL pool={pool} members={members} entries={entries} />');
    expect(mgr).toContain('<RecordPayoutsCard pool={pool} entries={entries} />');
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
    expect(ledger).toContain('STALE');
  });
  it('fee status comes from the Member Record, read-only here (setPaidStatus stays where it is)', () => {
    expect(ledger).toContain('buildPoolRoster({ pool, members, entries })');
    expect(ledger).toContain("r.paidStatus === 'PAID'");
    expect(ledger).not.toContain('setPaidStatus');
    expect(ledger).not.toContain('updateEntryPayment');
  });
  it('dbService exposes the private-record subscription the ledger needs', () => {
    expect(code('src/services/dbService.ts')).toContain('subscribeToPayoutRecordsPrivate:');
  });
});
