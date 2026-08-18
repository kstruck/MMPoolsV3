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
  it('is mounted on the NFL manager view (Record Payouts card folded in — T7), and owns the fee toggle', () => {
    const mgr = code('src/components/NFLPoolDashboard/NFLManagerView.tsx');
    expect(mgr).toContain("import { PaymentLedgerNFL } from './PaymentLedgerNFL'");
    expect(mgr).toContain('<PaymentLedgerNFL pool={pool} members={members} entries={entries} onTogglePaid={handleTogglePayment} onSettleRebuys={handleSettleRebuys} onSavePaidDetails={handleSavePaidDetails} savingFeeUid={isSavingPayment} />');
    // T7: the card is gone; free-form BONUS/ADJUSTMENT live in the ledger's "Other awards" block.
    expect(mgr).not.toContain('RecordPayoutsCard');
    expect(ledger).toContain("kind: otherDraft.kind, settled: otherDraft.settled");
    expect(ledger).toContain('Other awards');
    // The roster card is picks / remind / co-comm only — the fee toggle moved INTO the ledger (Kevin, 2026-08-16).
    expect(mgr).not.toMatch(/onClick=\{\(\) => handleTogglePayment\(row\.uid/);
    // "View full ledger" on the Overview and "Open Payment Ledger" on the member Payments tab both land on it.
    expect(mgr).toContain("onOpenLedger={() => setCommishTab('members')}");
    const dash = code('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
    expect(dash).toContain("onManagePayments={() => setActiveTab('manager', 'members')}");
    expect(dash).toContain("initialSection={searchParams.get('section')}");
    // The modal's method/date/note editor is folded into the ledger's fee cell; the writer is the same callable, details ride only with PAID.
    expect(mgr).toContain('dbService.setPaidStatus(pool.id, uid, true, details)');
    expect(ledger).toContain('onSavePaidDetails(r.uid, { paymentMethod: draft.method');
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
  it('Season $ column (PLAN-WEEKLY-PRIZES step 3): reads ONLY the published pool.seasonPlaces prize; the box records a season PLACE award (entryId, no week) or flips settlement', () => {
    expect(ledger).toContain('.seasonPlaces');
    // Season rows ride the same prizeRows/toggle path with `week: undefined` — the callable binds them to pool.seasonPlaces.
    expect(ledger).toContain("key: `season|${p.entryId}`, week: undefined");
    expect(ledger).toContain("r.kind !== 'PLACE' || r.week !== undefined || !r.entryId || !r.id.startsWith('season-')");
    expect(ledger).toContain("renderPrizeCell(r.entryId, 'season')");
    // The season half is priced on the server at finalization — never here.
    expect(ledger).not.toMatch(/computeSeasonPrizeSnapshot|priceSeasonPlaces|seasonPot/);
  });
  it('dbService exposes the private-record subscription the ledger needs', () => {
    expect(code('src/services/dbService.ts')).toContain('subscribeToPayoutRecordsPrivate:');
  });
});

/**
 * PLAN-PAYMENT-LEDGER T6 (K7) — the member's "My prizes": own rows only, reads
 * only, private settlement scoped to the viewer's uid.
 */
describe('MyPrizes — member view (T6, K7)', () => {
  const my = code('src/components/MyPrizes.tsx');
  it('is mounted on the member Payments tab with the viewer uid', () => {
    expect(code('src/components/PaymentsPanel.tsx')).toContain('<MyPrizes pool={pool} uid={user.id} />');
  });
  it('filters EVERY row to the viewer (published rows and records) and scopes the private subscription to the viewer uid', () => {
    expect(my).toContain('p.userId !== uid');
    expect(my).toContain('r.uid !== uid');
    expect(my).toContain('dbService.subscribeToPayoutRecordsPrivate(pool.id, rows => { setPriv(rows as Priv[]); setLoaded(l => ({ ...l, priv: true })); }, uid,');
  });
  it('never writes and never re-prices', () => {
    expect(my).not.toMatch(/recordPoolPayouts|setPayoutSettled|setPaidStatus|splitPrizes|priceWeeklyPlaces|priceSeasonPlaces|potBreakdown/);
  });
});

/**
 * PLAN-PAYMENT-LEDGER T2 (D1/D2) — the HYBRID weekly place list is editable in
 * manager Settings, not only at create time. Two things must hold, and neither
 * is visible from the callable's own tests:
 *
 *  1. `weeklyPayouts` is sent ONLY on a HYBRID save. `updatePoolSettings`
 *     merge-writes, so a list sent alongside a non-HYBRID mode is refused
 *     (WEEKLY_PAYOUTS_WRONG_MODE) — and leaving HYBRID must forget it locally
 *     too, or re-selecting HYBRID resurrects a list the server has deleted.
 *  2. The commissioner is TOLD before they save that leaving HYBRID promotes
 *     the season places to price every week (D1's "review your prize places").
 *
 * Assertions stay single-line: the working tree is CRLF, so a multi-line
 * `toContain` would pass on one checkout and fail on another.
 */
describe('manager Settings — the HYBRID weekly place list (T2)', () => {
  const mgr = code('src/components/NFLPoolDashboard/NFLManagerView.tsx');
  const count = (re: RegExp) => mgr.match(re)?.length ?? 0;

  it("sends weeklyPayouts only while HYBRID — on Pick'em AND on Margin", () => {
    expect(mgr).toContain("...(payoutMode === 'HYBRID' ? weeklyPayoutsPatch() : {}),");
    expect(mgr).toContain("...(marginPayoutMode === 'HYBRID' ? weeklyPayoutsPatch() : {}),");
    // One send per pool type, and nowhere else — a third would be a save path
    // that has not been mode-gated.
    expect(count(/weeklyPayoutsPatch\(\)/g)).toBe(2);
    expect(mgr).toContain('const weeklyPayoutsPatch = (): Record<string, unknown> => {');
  });

  /**
   * The editor promises "leave the list empty and the season places price both
   * pots". An emptied editor that stored `{ places: [] }` would break that
   * promise the expensive way: `weeklyPlacesFor` reads an empty list as "no
   * weekly prizes", leaving the whole weekly pot unassigned. (codex r1.)
   */
  it('an emptied editor CLEARS a stored list and stores nothing when there was none — never an empty list', () => {
    expect(mgr).toContain('if (weeklyPlaces.length > 0) return { weeklyPayouts: { places: weeklyPlaces } };');
    expect(mgr).toContain('return settings.weeklyPayouts ? { weeklyPayouts: null } : {};');
    expect(mgr).toContain('if (!weeklyPlacesTouched) return {};');
    // `{ places: [] }` must never be constructed by this file.
    expect(mgr).not.toMatch(/weeklyPayouts: \{ places: \[\] \}/);
  });

  /**
   * A stored `{ places: [] }` is a VALID, deliberate configuration (T1 keeps it
   * distinct from absent on purpose): this pool pays no weekly prizes. Seeding
   * "touched" from the stored value made every unrelated settings save rewrite
   * it to the fallback where the SEASON places price every week. (codex r2.)
   */
  it('an untouched editor never speaks — a deliberate empty stored list survives an unrelated save', () => {
    expect(mgr).toContain('const [weeklyPlacesTouched, setWeeklyPlacesTouched] = useState<boolean>(false);');
    expect(mgr).toContain('settings.weeklyPayouts?.places?.length ? settings.weeklyPayouts.places : null,');
  });

  it('leaving HYBRID clears the list locally and returning re-hydrates from the last KNOWN-STORED one, never the lagging prop', () => {
    expect(count(/if \(e\.target\.value !== 'HYBRID'\) \{ setWeeklyPlacesTouched\(false\); setWeeklyPlaces\(\[\]\); \}/g)).toBe(2);
    expect(count(/setWeeklyPlaces\(lastKnownWeeklyPlacesRef\.current\);/g)).toBe(2);
    expect(mgr).toContain("lastKnownWeeklyPlacesRef.current = activeMode === 'HYBRID' && weeklyPlaces.length > 0 ? weeklyPlaces : null;");
  });

  it('renders the editor on both HYBRID surfaces and warns on the way out (D1)', () => {
    expect(count(/<WeeklyPlacesEditor/g)).toBe(2);
    expect(mgr).toContain('<HybridExitNotice storedMode={storedPayoutMode} selectedMode={payoutMode} />');
    expect(mgr).toContain('<HybridExitNotice storedMode={storedPayoutMode} selectedMode={marginPayoutMode} />');
    expect(mgr).toContain('review your prize places before you save');
    // The notice only fires on the way OUT of a pool that IS hybrid today.
    expect(mgr).toContain("if (storedMode !== 'HYBRID' || selectedMode === 'HYBRID') return null;");
  });

  it('the live checks reuse the schema predicate — one definition of "ranks must be unique"', () => {
    expect(mgr).toContain("import { DUPLICATE_RANK_MESSAGE, uniqueRanks } from '@shared/schemas/common'");
    expect(mgr).toContain('uniqueRanks(places)');
  });
});
