import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { findStaleJobs, SCHEDULED_JOB_EXPECTATIONS, type JobHeartbeat } from '../lib/heartbeat';

// Scheduled-job liveness. These pin the thresholds that decide whether a job is
// reported dead — the signal that was MISSING when nflFinalizeSweepJob threw
// every day for ten days and when A5 snapshots silently wrote nothing.

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const beat = (agoMinutes: number, over: Partial<JobHeartbeat> = {}): JobHeartbeat =>
  ({ at: NOW - agoMinutes * MIN, ok: true, ...over });

const every10 = { consensusRefreshJob: { everyMinutes: 10 } };

describe('findStaleJobs — never-ran is the case that bit us', () => {
  it('flags a job with NO heartbeat at all', () => {
    // This is the finalize-sweep case: armed, deployed, never completed a run.
    expect(findStaleJobs({}, every10, NOW)).toEqual([
      { jobName: 'consensusRefreshJob', reason: 'never-ran', ageMinutes: null },
    ]);
  });

  it('flags a malformed heartbeat as never-ran rather than trusting it', () => {
    expect(findStaleJobs({ consensusRefreshJob: {} as any }, every10, NOW)[0].reason).toBe('never-ran');
  });
});

describe('findStaleJobs — staleness tolerance', () => {
  it('is quiet for a job that ran within its interval', () => {
    expect(findStaleJobs({ consensusRefreshJob: beat(5) }, every10, NOW)).toEqual([]);
  });

  it('tolerates ordinary scheduler lateness (default 3x the interval)', () => {
    // Cloud Scheduler is not punctual to the second and cold starts push runs
    // late. Flagging at exactly 1x would cry wolf constantly — and an alarm that
    // cries wolf is how the real outage gets ignored.
    expect(findStaleJobs({ consensusRefreshJob: beat(25) }, every10, NOW)).toEqual([]);
  });

  it('flags once it passes the tolerance', () => {
    const r = findStaleJobs({ consensusRefreshJob: beat(31) }, every10, NOW);
    expect(r[0]).toMatchObject({ jobName: 'consensusRefreshJob', reason: 'stale', ageMinutes: 31 });
  });

  it('honours a custom tolerance', () => {
    expect(findStaleJobs({ consensusRefreshJob: beat(15) }, every10, NOW, 1)[0].reason).toBe('stale');
  });
});

describe('findStaleJobs — failing is distinct from stale', () => {
  it('flags a recent run that threw', () => {
    // Ran on time but did not finish its work. Different fix from "not running".
    const r = findStaleJobs(
      { consensusRefreshJob: beat(2, { ok: false, error: 'FAILED_PRECONDITION: index' }) },
      every10, NOW,
    );
    expect(r[0]).toMatchObject({ reason: 'failing', error: 'FAILED_PRECONDITION: index' });
  });

  it('prefers STALE over failing when it is both old AND failed', () => {
    // Not running at all is the more urgent fact; reporting "failing" would
    // imply it is still executing.
    const r = findStaleJobs({ consensusRefreshJob: beat(90, { ok: false, error: 'x' }) }, every10, NOW);
    expect(r[0].reason).toBe('stale');
  });
});

describe('findStaleJobs — multi-job', () => {
  it('evaluates each job against its OWN interval', () => {
    const stale = findStaleJobs(
      { fast: beat(20), slow: beat(20) },
      { fast: { everyMinutes: 5 }, slow: { everyMinutes: 60 } },
      NOW,
    );
    // 20 min is stale for a 5-min job (>15) but fine for a 60-min one.
    expect(stale.map(s => s.jobName)).toEqual(['fast']);
  });

  it('reports every unhealthy job, not just the first', () => {
    const stale = findStaleJobs(
      { a: beat(999), b: beat(1, { ok: false }) },
      { a: { everyMinutes: 10 }, b: { everyMinutes: 10 }, c: { everyMinutes: 10 } },
      NOW,
    );
    expect(stale.map(s => s.reason).sort()).toEqual(['failing', 'never-ran', 'stale']);
  });

  it('returns empty when everything is healthy', () => {
    expect(findStaleJobs({ a: beat(1), b: beat(2) },
      { a: { everyMinutes: 10 }, b: { everyMinutes: 10 } }, NOW)).toEqual([]);
  });
});

describe('SCHEDULED_JOB_EXPECTATIONS must not drift from the wrapped jobs', () => {
  // A job wrapped in withHeartbeat() but MISSING from the expectations table is
  // never evaluated by findStaleJobs — so it silently drops out of monitoring
  // and we recreate the exact blind spot this module exists to close. The
  // reverse (an expectation for a job nobody wraps) reports a permanent
  // false "never-ran". Both are caught here.
  const SRC = path.resolve(__dirname, '..');

  function walk(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'shared' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, acc);
      else if (e.name.endsWith('.ts')) acc.push(full);
    }
    return acc;
  }

  const wrapped = new Set<string>();
  for (const file of walk(SRC)) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/withHeartbeat\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      wrapped.add(m[1]);
    }
  }

  it('found the wrapped jobs (guards against the regex silently matching nothing)', () => {
    expect(wrapped.size).toBeGreaterThanOrEqual(8);
  });

  it('every wrapped job has an expectation', () => {
    const missing = [...wrapped].filter(j => !(j in SCHEDULED_JOB_EXPECTATIONS)).sort();
    expect(missing, 'wrapped in withHeartbeat() but absent from SCHEDULED_JOB_EXPECTATIONS — it would never be checked').toEqual([]);
  });

  it('every expectation names a job that is actually wrapped', () => {
    const orphan = Object.keys(SCHEDULED_JOB_EXPECTATIONS).filter(j => !wrapped.has(j)).sort();
    expect(orphan, 'has an expectation but nothing wraps it — would report a permanent false never-ran').toEqual([]);
  });
});
