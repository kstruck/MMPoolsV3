import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no type declarations
import { evaluateAudit, collectAdvisories } from '../scripts/auditGate.mjs';

const adv = (name: string, ghsa: string, severity = 'high') => ({
  name,
  severity,
  title: `${name} advisory`,
  url: `https://github.com/advisories/${ghsa}`,
});
// npm audit lists the advisory on the package AND as a bare string on dependents.
const report = (...advisories: ReturnType<typeof adv>[]) => ({
  vulnerabilities: {
    ...Object.fromEntries(advisories.map((a) => [a.name, { via: [a] }])),
    dependent: { via: advisories.map((a) => a.name) },
  },
});
const NOW = new Date('2026-10-20T00:00:00Z');
const entry = (ghsa: string, expires = '2026-11-09', pkg = 'braces') => ({ ghsa, package: pkg, reason: 'no patched release', expires });

describe('audit gate', () => {
  it('fails an advisory that is not on the allow-list', () => {
    const r = evaluateAudit(report(adv('braces', 'GHSA-aaaa-bbbb-cccc')), { entries: [] }, NOW);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].reason).toMatch(/not on the allow-list/);
  });

  it('passes an allow-listed advisory that has not expired', () => {
    const r = evaluateAudit(report(adv('braces', 'GHSA-aaaa-bbbb-cccc')), { entries: [entry('GHSA-aaaa-bbbb-cccc')] }, NOW);
    expect(r.failures).toEqual([]);
    expect(r.allowed).toHaveLength(1);
  });

  it('fails again once the entry has expired', () => {
    const r = evaluateAudit(report(adv('braces', 'GHSA-aaaa-bbbb-cccc')), { entries: [entry('GHSA-aaaa-bbbb-cccc', '2026-10-01')] }, NOW);
    expect(r.failures[0].reason).toMatch(/expired/);
  });

  it('fails an entry with no expiry or no reason, so an exception cannot be permanent', () => {
    for (const bad of [{ ghsa: 'GHSA-aaaa-bbbb-cccc', reason: 'x' }, { ghsa: 'GHSA-aaaa-bbbb-cccc', expires: '2026-11-09' }]) {
      const r = evaluateAudit(report(adv('braces', 'GHSA-aaaa-bbbb-cccc')), { entries: [bad] }, NOW);
      expect(r.failures).toHaveLength(1);
    }
  });

  it('rejects an expiry more than 45 days away, accepts exactly 45', () => {
    const r = report(adv('braces', 'GHSA-aaaa-bbbb-cccc'));
    const far = evaluateAudit(r, { entries: [entry('GHSA-aaaa-bbbb-cccc', '2099-01-01')] }, NOW);
    expect(far.failures[0].reason).toMatch(/more than 45 days/);
    const edge = evaluateAudit(r, { entries: [entry('GHSA-aaaa-bbbb-cccc', '2026-12-04')] }, NOW);
    expect(edge.failures).toEqual([]);
    const over = evaluateAudit(r, { entries: [entry('GHSA-aaaa-bbbb-cccc', '2026-12-05')] }, NOW);
    expect(over.failures).toHaveLength(1);
  });

  it('lets one allow-listed advisory through but still fails a second, unlisted one', () => {
    const r = evaluateAudit(
      report(adv('braces', 'GHSA-aaaa-bbbb-cccc'), adv('proxy-addr', 'GHSA-dddd-eeee-ffff', 'critical')),
      { entries: [entry('GHSA-aaaa-bbbb-cccc')] },
      NOW,
    );
    expect(r.failures.map((f: { name: string }) => f.name)).toEqual(['proxy-addr']);
  });

  it('ignores moderate advisories and counts each (advisory, package) pair once', () => {
    const r = report(adv('a', 'GHSA-aaaa-bbbb-cccc'), adv('a', 'GHSA-aaaa-bbbb-cccc'), adv('m', 'GHSA-1111-2222-3333', 'moderate'));
    expect(collectAdvisories(r)).toHaveLength(1);
  });

  it('a waiver covers ONE package: the same advisory on a second package still fails (qodo #2 on #717)', () => {
    const r = evaluateAudit(
      report(adv('braces', 'GHSA-aaaa-bbbb-cccc'), adv('other-pkg', 'GHSA-aaaa-bbbb-cccc')),
      { entries: [entry('GHSA-aaaa-bbbb-cccc')] },     // waived for braces only
      NOW,
    );
    expect(r.allowed.map((a: { name: string }) => a.name)).toEqual(['braces']);
    expect(r.failures.map((f: { name: string }) => f.name)).toEqual(['other-pkg']);
  });

  it('an entry with no package waives nothing', () => {
    const noPackage = { ghsa: 'GHSA-aaaa-bbbb-cccc', reason: 'x', expires: '2026-11-09' };
    const r = evaluateAudit(report(adv('braces', 'GHSA-aaaa-bbbb-cccc')), { entries: [noPackage] }, NOW);
    expect(r.failures).toHaveLength(1);
  });

  it('reports an allow-list entry that no longer matches anything', () => {
    const r = evaluateAudit(report(), { entries: [entry('GHSA-aaaa-bbbb-cccc')] }, NOW);
    expect(r.unusedEntries).toEqual(['GHSA-aaaa-bbbb-cccc|braces']);
    expect(r.failures).toEqual([]);
  });
});
