import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addReportPage, foldParkedReport } from '../src/utils/resumableReport';

/**
 * THE OPERATOR MUST SEE EVERY COUNTER THE MIGRATION RETURNS.
 *
 * `OperationsPanel` pages these callables and aggregates the results, and the
 * Run Log it renders is the evidence Kevin reads before authorising a LIVE money
 * migration. It used to sum a list of field names kept by hand, so a counter
 * added to the server report was returned, dropped by the client, and simply
 * absent from that log.
 *
 * Measured on the 2026-08-27 dry run of `reconcilePaymentTruth`: three counters
 * missing — `entriesPaidNotLiable`, `staleSummariesRepaired` and `countsStamped`
 * — one of which was the exact number the operator had been told to read before
 * deciding whether to go live. `poolsSkipped` on the member-record backfill was
 * in the same state, and writing this test found a THIRD loop
 * (`backfillPublishedWeeks`) on the same pattern.
 *
 * These tests are derived FROM THE SERVER SOURCE rather than from a list written
 * here, because a list written here is the same defect one layer up.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * The numeric counters a migration's `const report = { … }` declares.
 *
 * Comments are stripped first — several counters carry long doc blocks that
 * themselves mention field names, and matching inside them would invent
 * counters that do not exist.
 */
function serverCounters(file: string): string[] {
  const src = stripComments(read(file));
  const start = src.indexOf('const report = {');
  expect(start, `${file}: no 'const report = {' block`).toBeGreaterThan(-1);
  const end = src.indexOf('\n  };', start);
  expect(end, `${file}: report block is not terminated`).toBeGreaterThan(start);
  return [...src.slice(start, end).matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):\s*0\s*,/gm)].map(m => m[1]);
}

/**
 * The keys the client's aggregate declares, found by a counter unique to it.
 *
 * Keyed on CONTENT, not on surrounding text. The first version of this helper
 * anchored on the literal `const agg = {` line plus the fields after it, and
 * broke the moment a comment was added inside the object — because this file
 * strips comments before matching. An anchor a comment can move is not an anchor.
 */
function clientAggregate(uniqueKey: string): string[] {
  const src = stripComments(read('src/components/admin/OperationsPanel.tsx'));
  const blocks = [...src.matchAll(/const agg = \{/g)].map((m) => {
    const start = m.index as number;
    return src.slice(start, src.indexOf('};', start));
  });
  const hit = blocks.filter(b => new RegExp(`\\b${uniqueKey}:\\s*0\\b`).test(b));
  expect(hit.length, `OperationsPanel: expected exactly ONE aggregate declaring ${uniqueKey}`).toBe(1);
  return [...hit[0].matchAll(/([a-zA-Z][a-zA-Z0-9]*):\s*0\b/g)].map(m => m[1]);
}

describe('the Run Log shows every counter the server reports', () => {
  it.each([
    ['reconcilePaymentTruth', 'functions/src/migrations/reconcilePaymentTruth.ts', 'membersPromoted'],
    ['backfillMemberRecords', 'functions/src/migrations/backfillMemberRecords.ts', 'membersCreated'],
  ])('%s: the client declares every counter the server returns', (_name, serverFile, uniqueKey) => {
    const server = serverCounters(serverFile);
    expect(server.length, 'no counters parsed — the extractor has drifted from the source').toBeGreaterThan(4);
    const client = new Set(clientAggregate(uniqueKey));
    const missing = server.filter(k => !client.has(k));
    expect(
      missing,
      `these counters would be INVISIBLE in the Run Log: ${missing.join(', ')}. ` +
      'Declare them in the aggregate so an empty run still renders them as 0.',
    ).toEqual([]);
  });

  it('🛑 NO page loop sums a hand-kept list of field names', () => {
    // The defect itself. A loop that names fields cannot notice a new one, and
    // the miss is invisible — the number reads LOW rather than erroring.
    const src = read('src/components/admin/OperationsPanel.tsx');
    // Exactly the THREE paged migrations, so a fourth added later is not
    // silently left on the old pattern. Writing this assertion is what found the
    // third one (publishedWeeks) still hand-listing its fields.
    expect(src.match(/addReportPage\(agg, r\);/g)).toHaveLength(3);
    // No `agg.<counter> += r.<counter> || 0` survives anywhere.
    expect(src).not.toMatch(/agg\.[a-zA-Z]+\s*\+=\s*r\.[a-zA-Z]+\s*\|\|\s*0/);
  });
});

describe('addReportPage — sums the SHAPE, not a list', () => {
  const base = () => ({ failures: [] as unknown[], poolsScanned: 0 });

  it('adds every numeric key, including one the aggregate never declared', () => {
    const agg = base();
    addReportPage(agg, { poolsScanned: 3, countsStamped: 7 });
    expect(agg.poolsScanned).toBe(3);
    // The whole point: a counter the client has never heard of still lands.
    expect((agg as Record<string, unknown>).countsStamped).toBe(7);
  });

  it('accumulates across pages', () => {
    const agg = base();
    addReportPage(agg, { poolsScanned: 3, countsStamped: 2 });
    addReportPage(agg, { poolsScanned: 4, countsStamped: 5 });
    expect(agg.poolsScanned).toBe(7);
    expect((agg as Record<string, unknown>).countsStamped).toBe(7);
  });

  it("leaves NON-numeric page state alone — it is the caller's, not a counter", () => {
    const agg = { failures: [] as unknown[], ok: true, dryRun: true, nextCursor: null as unknown };
    addReportPage(agg, { ok: false, dryRun: false, nextCursor: 'poolAbc', failures: [{ poolId: 'x' }] });
    expect(agg.ok).toBe(true);
    expect(agg.dryRun).toBe(true);
    expect(agg.nextCursor).toBeNull();
    // `failures` is an array and needs the caller's own handling (the reconcile
    // loop caps `plannedFixes` globally rather than concatenating).
    expect(agg.failures).toEqual([]);
  });

  it('ignores NaN and Infinity rather than poisoning a total', () => {
    const agg = base();
    addReportPage(agg, { poolsScanned: NaN });
    addReportPage(agg, { poolsScanned: Infinity });
    addReportPage(agg, { poolsScanned: 5 });
    expect(agg.poolsScanned).toBe(5);
  });

  it('foldParkedReport still folds a parked total AND its failures', () => {
    // The resume path had this right all along; it now shares the summing.
    const agg = { failures: [{ poolId: 'live' }] as unknown[], poolsScanned: 2 };
    foldParkedReport(agg, { failures: [{ poolId: 'parked' }], poolsScanned: 5, countsStamped: 1 });
    expect(agg.poolsScanned).toBe(7);
    expect((agg as Record<string, unknown>).countsStamped).toBe(1);
    expect(agg.failures).toHaveLength(2);
  });
});
