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
    expect(mgr).toContain('<PaymentLedgerNFL pool={pool} members={members} entries={entries} onTogglePaid={handleTogglePayment} onSettleRebuys={handleSettleRebuys} onSavePaidDetails={handleSavePaidDetails} savingFeeUid={isSavingPayment} duesByUid={duesByUid} liableByUid={liableByUid}');
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
    expect(mgr).toContain('dbService.setPaidStatus(pool.id, uid, true, details, entryId)');
    expect(ledger).toContain('onSavePaidDetails(r.uid, { paymentMethod: draft.method');
    const bento = code('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');
    expect(bento).toContain('onClick={onOpenLedger}');
    expect(bento).not.toContain('Advanced Payment Ledger');
  });
  it('is one spreadsheet: a column per scored week, fee paid checkbox, totals', () => {
    expect(ledger).toContain('nflWeekChip(seasonType, week)');
    expect(ledger).toContain("aria-label={`${r.name} entry fee paid`}");
    expect(ledger).toContain('onTogglePaid?.(r.uid, r.entryId, r.paidStatus');
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
    expect(mgr).toContain('return (lastKnownWeeklyPlacesRef.current || settings.weeklyPayouts) ? { weeklyPayouts: null } : {};');
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
    // Re-hydrating is NOT editing (codex r8): a bare toggle away-and-back must
    // not make this list eligible to re-send over a newer one from another session.
    expect(mgr).not.toMatch(/setWeeklyPlaces\(lastKnownWeeklyPlacesRef\.current\);\s*setWeeklyPlacesTouched\(true\)/);
    // The ONLY things that mark it touched are the two editors' onChange props.
    expect(count(/setWeeklyPlacesTouched\(true\)/g)).toBe(2);
    expect(count(/onChange=\{next => \{ setWeeklyPlacesTouched\(true\); setWeeklyPlaces\(next\); \}\}/g)).toBe(2);
    expect(mgr).toContain("lastKnownWeeklyPlacesRef.current = activeMode === 'HYBRID' && weeklyPlaces.length > 0 ? weeklyPlaces : null;");
  });

  it('renders the editor on both HYBRID surfaces and warns on the way out (D1)', () => {
    expect(count(/<WeeklyPlacesEditor/g)).toBe(2);
    expect(mgr).toContain('<HybridExitNotice storedMode={storedPayoutMode} selectedMode={payoutMode} hasWeeklyList={!!settings.weeklyPayouts?.places?.length} />');
    expect(mgr).toContain('<HybridExitNotice storedMode={storedPayoutMode} selectedMode={marginPayoutMode} hasWeeklyList={!!settings.weeklyPayouts?.places?.length} />');
    expect(mgr).toContain('review your prize places before you save');
    // The notice only fires on the way OUT of a pool that IS hybrid today.
    expect(mgr).toContain("if (storedMode !== 'HYBRID' || selectedMode === 'HYBRID') return null;");
  });

  it('+ Add place cannot mint a duplicate rank — the next rank is one past the highest present', () => {
    expect(mgr).toContain('const nextRank = places.reduce((max, p) => Math.max(max, Number(p.rank) || 0), 0) + 1;');
    expect(mgr).not.toContain('rank: places.length + 1');
  });

  it('the live checks reuse the schema predicate — one definition of "ranks must be unique"', () => {
    expect(mgr).toContain("import { DUPLICATE_RANK_MESSAGE, uniqueRanks } from '@shared/schemas/common'");
    expect(mgr).toContain('uniqueRanks(places)');
  });
});

/**
 * PLAN-PAYMENT-LEDGER T2 — the three qodo findings absorbed on #471. Each is a
 * money or lost-update defect, not a style note; the other nine findings were
 * rejected on the PR with evidence.
 */
describe('manager weekly-place editor — qodo #471 absorptions (T2)', () => {
  const mgr = code('src/components/NFLPoolDashboard/NFLManagerView.tsx');

  /**
   * qodo #2. `payoutPlaceSchema.percentage` is `z.number().min(0).max(100)` and
   * `splitPrizes` has a test for a 33.3 / 33.3 / 33.4 split, so flooring here
   * silently re-allocated a pot the schema and the scorer both accept. `rank`
   * stays integral — that one IS `z.number().int()`.
   */
  it('percentages are NOT floored, and the input allows a decimal step; rank still is', () => {
    expect(mgr).toContain('percentage: Math.max(0, Math.min(100, Number(e.target.value) || 0))');
    expect(mgr).not.toMatch(/percentage: Math\.max\(0, Math\.min\(100, Math\.floor/);
    expect(mgr).toContain('<input type="number" min={0} max={100} step="any" value={p.percentage}');
    expect(mgr).toContain('rank: Math.max(1, Math.floor(Number(e.target.value) || 1))');
  });

  /**
   * qodo #3. The flag means "edited since the last save". Left latched, every
   * LATER unrelated save re-sent this list and would overwrite a newer weekly
   * list saved from another session between the two saves.
   */
  it('a successful save clears the touched flag, so a later unrelated save re-sends nothing', () => {
    expect(mgr).toContain('setWeeklyPlacesTouched(false);');
    const save = mgr.slice(mgr.indexOf('lastKnownWeeklyPlacesRef.current = activeMode'));
    expect(save.slice(0, 400)).toContain('setWeeklyPlacesTouched(false);');
  });

  /** qodo #5 — this file's own button convention, used by every other button in it. */
  it('the editor buttons carry the file\'s uppercase display typography', () => {
    expect(mgr).toContain('font-display text-sm font-bold uppercase tracking-[0.05em] text-brandred-600');
    expect(mgr).toContain('font-display text-sm font-bold uppercase tracking-[0.05em] border border-line');
  });
});

/**
 * PLAN-MULTI-ENTRY-DUES P2-T5b (D10) — per-entry dues in the commissioner
 * ledger. Root vitest has no DOM, so these are comment-stripped wiring guards,
 * the same shape as the T5 block above.
 *
 * Kevin, 2026-08-25: "it shows my two entries, but only one has the payment
 * checkbox ... have each row responsible for the entry fee."
 */
describe('PaymentLedgerNFL — per-entry dues (DUES T5b)', () => {
  const ledger = code('src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx');
  const mgr = code('src/components/NFLPoolDashboard/NFLManagerView.tsx');
  const db = code('src/services/dbService.ts');

  it('the fee cell and the checkbox no longer hide behind r.first', () => {
    // The defect in its own hand: `r.first ?` on the fee cell and `r.first &&`
    // on the checkbox are what put ONE $50 figure and ONE all-or-nothing box
    // beside a member's first entry.
    expect(ledger).not.toContain('{r.first ? (r.feeOwed === null');
    expect(ledger).not.toContain('{r.first && (r.paidStatus === null');
    expect(ledger).toContain('{r.feeOwed === null ? <span className="text-faint">—</span> : money(r.feeOwed)}');
  });

  it('the toggle carries the ENTRY id, all the way to the callable', () => {
    expect(ledger).toContain('onTogglePaid?: (uid: string, entryId: string, currentStatus: string) => void;');
    expect(ledger).toContain('onTogglePaid?.(r.uid, r.entryId, r.paidStatus');
    expect(mgr).toContain('const handleTogglePayment = async (uid: string, entryId: string, currentStatus: string)');
    expect(mgr).toContain('dbService.setPaidStatus(pool.id, uid, nextPaid, undefined, entryId)');
    expect(db).toContain('...(entryId ? { entryId } : {}),');
  });

  it('a row fee is ONE entry fee; the member total moves to a subtotal', () => {
    expect(ledger).toContain('const perRow = nCharge > 0 ? Math.floor(feeOwed / nCharge) : 0;');
    expect(ledger).toContain('memberTotal: r.feeOwed === null ? null : feeOwed');
    expect(ledger).toContain('— total due');
  });

  it('🛑 base dues and rebuys are summed in SEPARATE loops (D10 says mixing them ships a double-count)', () => {
    // THE DERIVATION MOVED (2026-08-28). It lives in `./ledgerTotals` so the
    // totals — including the `unallocated` figure that makes the row reconcile
    // — can be asserted as BEHAVIOUR rather than as source text.
    // `tests/ledger-totals.test.ts` is the real guard now: it builds a member
    // with two entries and one rebuy and fails if the rebuy is counted twice,
    // which this slice could only ever infer. This half stays because a
    // regression that merges the loops is still worth catching at the source,
    // and because the component must not grow a second copy.
    const totalsSrc = code('src/components/NFLPoolDashboard/ledgerTotals.ts');
    const from = totalsSrc.indexOf('let owedIn = 0, paidIn = 0');
    // ⚠️ The end anchor is searched FROM the start index: an anchor found
    // BEFORE the start would slice to '', and an empty slice passes every
    // `not.toMatch` below while asserting nothing.
    const totals = totalsSrc.slice(from, totalsSrc.indexOf('for (const p of prizes)', from));
    expect(totals.length).toBeGreaterThan(100);   // the slice must not be empty
    // Base dues: every row, no `first` gate.
    expect(totals).toContain('for (const r of rows) {');
    expect(totals).toContain('owedIn += r.feeOwed;');
    // Rebuys: ONCE per member, and the gate must still be there.
    expect(totals).toContain('if (!r.first) continue;');
    expect(totals).toContain('owedIn += r.rebuyOwed;');
    // MUST catch the regression: the two must not be added in one pass.
    expect(totals).not.toMatch(/owedIn \+= r\.feeOwed \+ r\.rebuyOwed/);
    // ...and the component delegates rather than keeping its own copy.
    expect(ledger).toContain('computeLedgerTotals(ledgerRows, prizeRows, others)');
    expect(ledger).not.toContain('let owedIn = 0, paidIn = 0');
  });

  /**
   * THE FIGURE THAT MAKES THE ROW ADD UP.
   *
   * The ledger shipped four totals and no reconciliation between them, so a
   * commissioner reading "$100 in / $84 out" could not tell a correct ledger
   * from a broken one. The arithmetic is asserted in
   * `tests/ledger-totals.test.ts`; this pins that the page actually RENDERS it,
   * and that it is gated on the prize side being known.
   */
  it('the totals row states the gap between money in and money out', () => {
    expect(ledger).toContain("totals.unallocated > 0 ? 'Unallocated ' : 'Over-committed '");
    expect(ledger).toContain('prizesKnown && totals.unallocated !== 0');
    // Never printed against a prize total that has not loaded or failed.
    expect(ledger).toContain('const prizesUnavailable = recapsUnavailable || recordsUnavailable;');
    expect(ledger).toContain('const prizesKnown = recapsLoaded && recordsLoaded && !prizesUnavailable;');
  });

  /**
   * AN ERRORED LISTENER MUST NOT READ AS "$0 OWED OUT".
   *
   * `subscribeToWeeklyRecaps` / `subscribeToPayoutRecords` call back with `[]`
   * when no `onError` is passed. The ledger passed none, so a permission or
   * offline failure flipped `loaded` true and rendered a confident $0 on a pool
   * that owed thousands — defeating the placeholder guard in exactly the case
   * it exists for.
   */
  it('both public prize listeners report failure instead of falling back to an empty list', () => {
    expect(ledger).toContain('() => setRecapsUnavailable(true)');
    expect(ledger).toContain('() => setRecordsUnavailable(true)');
    // Cleared on pool switch, so a previous pool's failure cannot stick.
    expect(ledger).toContain('setRecapsUnavailable(false); setRecordsUnavailable(false);');
    // And the callable-side contract that makes the above reachable.
    expect(db).toContain('if (onError) onError(error); else callback([]);');
  });

  it('presence in the dues map IS the paid signal, and an ABSENT map falls back to the member flag', () => {
    expect(ledger).toContain("Object.prototype.hasOwnProperty.call(memberDues, entryId) ? 'PAID' : 'UNPAID'");
    expect(ledger).toContain(': r.paidStatus;');          // the R3 fallback
  });

  it('the dues map comes from the CALLABLE — it cannot be read from Firestore', () => {
    expect(db).toContain("httpsCallable(functions, 'getPoolDues')");
    expect(mgr).toContain('dbService.getPoolDues(forPool)');
    // undefined, never {} — an empty object would say "nobody paid" mid-load.
    expect(mgr).toContain('} | undefined>(undefined);');
    // No subscription behind it, so every write pulls it again.
    expect(mgr).toContain('await refreshDues();');
  });

  it('the dues fetch cannot render one pool payment state against another', () => {
    // Entry ids are DETERMINISTIC (`uid`, `e2:uid`) and a member can be in many
    // pools, so a late response would otherwise paint the previous pool's
    // payments onto these rows — and hand the commissioner a checkbox acting on
    // it. Cleared on pool change, and every response is stamped with the pool it
    // was asked for.
    expect(mgr).toContain('const forPool = pool.id;');
    expect(mgr).toContain('setDuesPayload({ poolId: forPool, dues, liable, paidMirrors });');
    // Read back through a MATCH, so the stale case is unrepresentable rather
    // than something an effect has to remember to clear.
    expect(mgr).toContain("const duesByUid = duesPayload?.poolId === pool.id ? duesPayload.dues : undefined;");
    expect(mgr).toContain("const liableByUid = duesPayload?.poolId === pool.id ? duesPayload.liable : undefined;");
    // An OLDER response for the SAME pool must not land on a newer one: the
    // mount fetch can finish after a write's refresh and revert a just-paid
    // row, which invites the commissioner to REVERSE a payment they just made.
    expect(mgr).toContain('const duesSeqRef = useRef(0);');
    expect(mgr).toContain('if (seq === duesSeqRef.current) setDuesPayload({ poolId: forPool, dues, liable, paidMirrors });');
    // A failed READ after a successful WRITE must clear, not keep: the loaded
    // map is pre-write, so showing it says "unpaid" about money just taken.
    expect(mgr).toContain('setDuesPayload(prev => (prev?.poolId === forPool ? undefined : prev));');
  });

  it('the details editor is keyed by ENTRY, so two rows of one member cannot both open', () => {
    expect(ledger).not.toContain('editUid');
    expect(ledger).toContain('editKey === r.entryId');
    expect(ledger).toContain('setEditKey(r.entryId)');
  });

  it('🛑 a ZERO fee survives — the seeded host is not charged by the per-entry rewrite', () => {
    // A commissioner who hosts without playing carries feeOwed: 0 deliberately.
    // Replacing that with rates.entryFee would charge them on the ledger and in
    // "Owed in", and hand them a checkbox setPaidStatus refuses (no liable
    // entry). This is N1 reaching the UI.
    expect(ledger).toContain('const perRow = nCharge > 0 ? Math.floor(feeOwed / nCharge) : 0;');
    // MUST catch the regression: the unconditional form.
    expect(ledger).not.toContain('const entryFee = r.feeOwed === null ? null : rates.entryFee;');
    // The three-way rule, in order: a member owing 0 is never charged; a known
    // liable set decides; and until it loads, the member's FIRST row only.
    expect(ledger).toContain('const isChargeable = (entryId: string, i: number) => feeOwed === 0 ? false');
    expect(ledger).toContain(': memberLiable ? memberLiable.includes(entryId)');
    expect(ledger).toContain(': i === 0;');
  });

  it('🛑 the row fees SPLIT the member authoritative feeOwed and must add up to it', () => {
    // A legacy stamp can predate a fee change, so feeOwed need not equal
    // rates.entryFee x liable. Copying the current rate onto each row would
    // make the rows not add up to the subtotal beneath them — and "Owed in"
    // sums the rows, so the pool total would drift from what members owe.
    expect(ledger).toContain('const remainder = nCharge > 0 ? feeOwed - perRow * nCharge : 0;');
    // The remainder rides the FIRST chargeable row, so the sum is EXACT.
    expect(ledger).toContain("chargeable ? perRow + (entryId === chargeableIds[0] ? remainder : 0)");
  });

  it('🛑 only the server can say WHICH entries are liable, and the ledger waits for it', () => {
    // The Member Record carries the liable COUNT and never WHICH — a
    // participant-readable document must not say which entry has a pick for an
    // unrevealed week. Charging every roster entry overstates "Owed in";
    // charging the first N by index mis-attributes when entry 2 picked and
    // entry 1 did not.
    const fn = code('functions/src/nflPoolDues.ts');
    expect(fn).toContain('liable: Record<string, string[]>;');
    expect(fn).toContain('liableEntryIds(rec, m.id, pickedByOwner.get(m.id) ?? [])');
    expect(fn).toContain('return { dues, liable, paidMirrors };');
    expect(ledger).toContain('const memberLiable = liableByUid?.[r.uid];');
  });

  it('a row with NO fee gets no checkbox — a control that always errors is worse than none', () => {
    // setPaidStatus refuses a non-liable entryId with ENTRY_NOT_FOUND, so the
    // box would be a button that cannot succeed.
    expect(ledger).toContain('r.feeOwed === null ? <span className="text-faint" title=');
  });

  it('the rebuy control stays on ONE row per member', () => {
    // rebuyOwed is a member-level SUM; a control per row would offer to settle
    // the same money N times. Its saving key is the uid, matching the handler.
    expect(ledger).toContain('{r.first && r.rebuyOwed > 0 && r.hasMember && onSettleRebuys');
    expect(ledger).toContain('onClick={() => onSettleRebuys(r.uid, !settled)}');
  });

  it('the subtotal spans exactly the columns it has not already emitted', () => {
    // Member + Entry fee + Fee paid + one per scored week + Season $ = weeks+4.
    // The subtotal emits three, so the span is weeks+1. An over-wide span
    // invents an unheaded column and shears the table.
    expect(ledger).toContain('colSpan={weeks.length + 1}');
    expect(ledger).not.toContain('colSpan={2 + weeks.length}');
  });

  it('an UNKNOWN status still renders "—", never an unticked box', () => {
    // An unticked box is a statement that the fee is unpaid; "—" is the absence
    // of one. The prize-recipient-outside-the-roster row is the case.
    expect(ledger).toContain('r.paidStatus === null ? <span className="text-faint text-[10px]">unknown</span>');
  });
});

/**
 * PLAN-MULTI-ENTRY-DUES P2-T6 (D2/D3/D12) — the delete control. Comment-stripped
 * wiring guards, same shape as the blocks above.
 */
describe('PaymentLedgerNFL — the delete control (DUES T6)', () => {
  const ledger = code('src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx');
  const mgr = code('src/components/NFLPoolDashboard/NFLManagerView.tsx');
  const db = code('src/services/dbService.ts');

  it('is DISABLED WITH THE REASON, never hidden', () => {
    // A hidden control is indistinguishable from a missing feature, and leaves
    // the commissioner guessing why an entry they can see cannot go.
    expect(ledger).toContain('disabled={!!r.deleteRefusal || deletingEntryId === r.entryId}');
    expect(ledger).toContain('title={r.deleteRefusal ??');
  });

  it('mirrors BOTH server refusals, in the server own words', () => {
    expect(ledger).toContain('This pool has already scored a week');
    expect(ledger).toContain('This entry is marked paid. Un-mark its payment first');
    // D3 is read from the SAME three fields the callable reads, so the mirror
    // cannot drift from the gate.
    expect(ledger).toContain("Object.values(p.publishedWeeks ?? {}).some(v => v === true)");
    expect(ledger).toContain("|| Object.values(p.scoredWeeks ?? {}).some(v => v === true)");
    expect(ledger).toContain("|| Number(p.scoredThroughWeek ?? 0) > 0");
    // The callable ALSO refuses when `standings/current` exists — a case a
    // provisional pass reaches with none of the three markers above. This
    // component cannot read that document, so it uses the pool-doc field
    // written in the SAME fenced write.
    expect(ledger).toContain('|| p.lastScoredAt !== undefined;');
  });

  it('🛑 the UI refusal is a COURTESY — the callable is the gate', () => {
    // A stale tab must not be able to delete a paid or scored entry, so the
    // server re-checks. The client never sends a "force" of any kind.
    const fn = code('functions/src/nflEntryDelete.ts');
    expect(fn).toContain('ENTRY_IS_PAID');
    expect(fn).toContain('ENTRY_IS_SCORED');
    expect(db).toContain("httpsCallable(functions, 'deleteNFLEntry')");
    // Scoped to THIS wrapper: `dbService` contains unrelated matches for
    // "force" elsewhere, and a whole-file assertion would either pass by
    // accident or fail for a reason that has nothing to do with deletes.
    const from = db.indexOf('deleteNFLEntry: async');
    const wrapper = db.slice(from, db.indexOf('},', from));
    expect(wrapper.length).toBeGreaterThan(80);
    expect(wrapper).toContain('withCorrelationId({ poolId, targetUid, entryIndex })');
    // No override of any kind travels from the client — the payload is exactly
    // the three fields the schema accepts.
    expect(wrapper).not.toMatch(/force|override|skip/i);
  });

  it('explain-then-confirm: names the entry and states what MOVES', () => {
    expect(mgr).toContain('<ConfirmActionModal');
    expect(mgr).toContain('title="Delete this entry?"');
    expect(mgr).toContain('Their dues drop by one entry fee and the pot');
    expect(mgr).toContain('do not come back');
    expect(mgr).toContain('destructive');
    // The delete only runs from the modal's confirm — never straight off the row.
    expect(mgr).toContain('onDeleteEntry={(uid, entryIndex, entryId, label, movesMoney) => setPendingDelete({ poolId: pool.id, uid, entryIndex, entryId, label, movesMoney })}');
    expect(mgr).toContain('onConfirm={() => { void handleDeleteEntry(); }}');
  });

  it('🛑 the CONFIRMATION tells the truth for a non-liable entry too', () => {
    // An entry with no committed pick was never charged, so deleting it moves
    // neither dues nor the pot. Promising a drop at the irreversible step would
    // contradict the outcome message the commissioner reads a second later.
    // Three states, because there are three truths — and "chargeable" is NOT
    // the predicate: a participant's entry #1 carries the JOIN liability, so it
    // shows a fee, but deleting it leaves that liability intact and the server
    // returns liabilityDelta 0.
    expect(mgr).toContain('pendingDelete.movesMoney === true');
    expect(mgr).toContain('pendingDelete.movesMoney === false');
    expect(mgr).toContain('NOTHING changes about their dues or the pot');
    expect(mgr).toContain('No money moves — this entry carries no dues.');
    expect(ledger).toContain('onDeleteEntry(r.uid, r.entryIndex, r.entryId, r.name, r.deleteMovesMoney)');
    // The row's ACTUAL id, never one reconstructed from the index: an entry can
    // sit at an auto-generated id (multiEntry.ts §0a), and a reconstructed id
    // would never match — the row would stay enabled mid-delete.
    expect(mgr).toContain('setDeletingEntryId(entryId);');
    expect(mgr).not.toContain('setDeletingEntryId(entryIdFor(');
  });

  it('🛑 the money prediction reproduces the SERVER arithmetic, not "is there a fee"', () => {
    // liability = max(joinLiability, playedEntries); an entry only lowers
    // `played` if it actually holds a pick.
    expect(ledger).toContain("const joinLiability = mrec?.role === 'MANAGER' ? 0 : 1;");
    expect(ledger).toContain('const thisHoldsAPick = played > 0 && !!memberLiable?.includes(entryId);');
    expect(ledger).toContain('Math.max(joinLiability, played - (thisHoldsAPick ? 1 : 0)) < Math.max(joinLiability, played)');
    // Unknown until the liable set loads — and then it claims NEITHER outcome.
    expect(ledger).toContain('memberLiable === undefined ? null');
    expect(mgr).toContain('recalculated by the server and reported when it finishes');
  });

  it('the entry document own paid mirror also disables the control', () => {
    // The callable refuses on ANY of three payment sources; they can diverge on
    // a legacy record, and mirroring only two leaves a button that errors.
    expect(ledger).toContain("const mirrorPaid = paidMirrorIds ? paidMirrorIds.includes(entryId) : e?.paidStatus === 'PAID';");
    // The ledger cannot read raw entries for OTHER members (own-entry-only
    // pre-reveal), so the authoritative source is the callable, not the local
    // projection — which is why the earlier local-only check was ineffective
    // for exactly the rows that matter.
    const fnDues = code('functions/src/nflPoolDues.ts');
    expect(fnDues).toContain("if (data.paidStatus === 'PAID') paidMirrors.push(e.id);");
    expect(fnDues).toContain('return { dues, liable, paidMirrors };');
    expect(ledger).toContain("(entryPaid === 'PAID' || mirrorPaid) ?");
    // 🛑 AND THE FIELD MUST ACTUALLY BE CARRIED. An earlier version read
    // `paidStatus` off an object built as { id, entryIndex, entryName } — so the
    // check was INERT: present in the source, always false at runtime, and a
    // source-text assertion happily passed. Pin the plumbing, not the phrase.
    expect(ledger).toContain('entryName?: string; paidStatus?: unknown }>();');
    expect(ledger).toContain('entryName: e.entryName ?? byId.get(e.id)?.entryName, paidStatus: e.paidStatus }');
  });

  it('🛑 a pending delete is BOUND to the pool that opened it', () => {
    // This dashboard is reused for another pool on navigation, and uids and
    // entry indexes are shared across pools by construction — so a confirmation
    // queued in pool A could HARD DELETE the matching entry in pool B, with no
    // tombstone to recover from (D12).
    expect(mgr).toContain('const { poolId, uid, entryIndex, entryId, label } = pendingDelete;');
    expect(mgr).toContain('if (poolId !== pool.id) {');
    expect(mgr).toContain('dbService.deleteNFLEntry(poolId, uid, entryIndex)');
    // MUST catch the regression: the callable must never be handed the CURRENT
    // pool id when the confirmation was opened against another.
    expect(mgr).not.toContain('dbService.deleteNFLEntry(pool.id, uid, entryIndex)');
  });

  it('the played-entries fallback keeps the LEGACY MANAGER limb', () => {
    // memberPlayedEntries counts a MANAGER whose record predates the latch but
    // carries feeOwed > 0 as one played entry. Omitting it tells such a manager
    // that deleting their only picked entry changes nothing, while the server
    // lowers both their dues and the pot.
    expect(ledger).toContain("|| (mrec?.role === 'MANAGER' && Number(r.feeOwed ?? 0) > 0) ? 1 : 0);");
  });

  it('the result says WHICH kind of delete happened', () => {
    // A delete that costs nothing and one that lowers the pot are different
    // events; the commissioner should not have to infer which.
    expect(mgr).toContain('It had no committed pick, so no dues or pot figures changed.');
    expect(mgr).toContain('Their dues and the pot each dropped by one entry.');
  });
});
