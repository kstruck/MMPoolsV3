import { describe, it, expect } from 'vitest';
import { classifyFrozenChange } from '../lib/frozenSpreadAudit';
import type { FrozenSpread } from '../shared/frozenSpread';

/**
 * PLAN-NFL-SPREAD-FREEZE 2.4 — the approval table.
 *
 * Three separate times this plan pointed a detector at the mechanism it exists to
 * protect, and every one of those is a case below. If any of them regresses, the
 * symptom is not a missed alarm — it is an audit trail that files sixteen
 * legitimate writes a week as unauthorized, which is worse, because a log nobody
 * trusts is a log nobody reads.
 */

const rec = (over: Partial<FrozenSpread> = {}): FrozenSpread => ({
  gameId: 'g1', value: -3.5, frozenAt: 1_700_000_000_000,
  season: '2026', seasonType: 1, week: 4, source: 'freeze',
  ...over,
});

describe('CREATE — no prior record', () => {
  it.each(['freeze', 'backfill'] as const)('is APPROVED when source is %s', (source) => {
    // Revision round 6: "no fresh overrideId means unapproved" files every game of
    // every scheduled freeze as unauthorized, because a freeze by design carries
    // none — the audit trail is worthless inside a month.
    const v = classifyFrozenChange(undefined, rec({ source }));
    expect(v).toMatchObject({ kind: 'create', approved: true, rescore: true });
  });

  it('is APPROVED when an override creates one — a late-added game getting its line', () => {
    // R3's remediation path, and the FOURTH time this plan pointed a detector at
    // the mechanism it protects: Revision 1's table approves a create only from
    // `freeze` or `backfill`, while two paragraphs later the plan says both
    // override paths write `source: 'override'` precisely so the table does not
    // file a legitimate override as unauthorized. Read literally it did anyway.
    expect(classifyFrozenChange(undefined, rec({ source: 'override', overrideId: 'o1' }))).toMatchObject({
      kind: 'create', approved: true, rescore: true,
    });
  });

  it('is UNAPPROVED for a create claiming `override` with NO id', () => {
    expect(classifyFrozenChange(undefined, rec({ source: 'override' }))).toMatchObject({
      kind: 'create', approved: false,
    });
  });

  it('is UNAPPROVED when nothing declared a source — the console write', () => {
    const v = classifyFrozenChange(undefined, { ...rec(), source: undefined as never });
    expect(v).toMatchObject({ kind: 'create', approved: false, rescore: true });
    expect(v.reason).toContain('only freeze, backfill, or an override');
  });

  it('ENQUEUES A RESCORE even when approved', () => {
    // A create still moves the canonical number: before the record existed,
    // readers fell back to `nfl_games.spread`.
    expect(classifyFrozenChange(undefined, rec()).rescore).toBe(true);
  });
});

describe('AMEND — an existing record changes', () => {
  it('is APPROVED for an override carrying a FRESH id', () => {
    const before = rec({ overrideId: 'o1', source: 'override' });
    const after = rec({ value: -7, overrideId: 'o2', source: 'override' });
    expect(classifyFrozenChange(before, after)).toMatchObject({ kind: 'amend', approved: true, rescore: true });
  });

  it('is UNAPPROVED when the override id is REUSED', () => {
    const before = rec({ overrideId: 'o1', source: 'override' });
    const after = rec({ value: -7, overrideId: 'o1', source: 'override' });
    expect(classifyFrozenChange(before, after)).toMatchObject({ approved: false });
  });

  it('is UNAPPROVED when the value moves with no id at all — the console edit', () => {
    expect(classifyFrozenChange(rec(), rec({ value: -7 }))).toMatchObject({ kind: 'amend', approved: false, rescore: true });
  });

  it('FIRES WHEN frozenAt IS REMOVED, leaving everything else alone', () => {
    // Round 15 of the original: a whole-map console write can drop the marker
    // while leaving the value exactly as it was. On a predicate that ignored
    // `frozenAt`, nothing fires — no rescore, no audit — and the game leaves the
    // detector permanently after one quiet write.
    const after = { ...rec(), frozenAt: undefined as never };
    expect(classifyFrozenChange(rec(), after)).toMatchObject({ kind: 'amend', approved: false, rescore: true });
  });

  it('fires when the slate key is rewritten', () => {
    expect(classifyFrozenChange(rec(), rec({ week: 5 }))).toMatchObject({ kind: 'amend', approved: false });
  });

  it('AN APPROVED OVERRIDE STILL ENQUEUES A RESCORE', () => {
    // Original round 11, and collapsing the two questions breaks the override
    // outright: it exists to correct a line AFTER results may have been scored, so
    // exempting it from the rescore would leave finalized ATS standings on the old
    // number *because the change was properly approved*.
    const v = classifyFrozenChange(rec({ overrideId: 'o1' }), rec({ value: -7, overrideId: 'o2', source: 'override' }));
    expect(v.approved).toBe(true);
    expect(v.rescore).toBe(true);
  });
});

describe('DELETE', () => {
  it('is NEVER approved, and always enqueues', () => {
    // Reads fall back to the working spread, so finalized ATS standings may need
    // repair — and nothing in the design deletes a frozen record.
    expect(classifyFrozenChange(rec(), undefined)).toMatchObject({ kind: 'delete', approved: false, rescore: true });
  });
});

describe('NOOP', () => {
  it('a write that changed nothing material does neither', () => {
    expect(classifyFrozenChange(rec(), rec())).toMatchObject({ kind: 'noop', approved: true, rescore: false });
  });

  it('neither side present', () => {
    expect(classifyFrozenChange(undefined, undefined)).toMatchObject({ kind: 'noop', rescore: false });
  });
});
