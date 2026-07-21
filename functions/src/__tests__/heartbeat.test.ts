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

// THE INVARIANT THAT WOULD HAVE CAUGHT THIS.
//
// The two checks above are bidirectional between `withHeartbeat` and
// SCHEDULED_JOB_EXPECTATIONS — but both start from the set of WRAPPED jobs, so
// a scheduled job nobody wrapped is invisible to both. That is exactly how the
// entire NFL fleet stayed unmonitored: syncNFLScoresJob, nflFinalizeSweepJob,
// nflLockWatchJob and lockNFLSpreadsJob were never wrapped, so nothing
// complained, and nflFinalizeSweepJob then threw FAILED_PRECONDITION every day
// for ten days with nobody noticing.
//
// This closes the loop from the other end: every onSchedule() in the codebase
// must be wrapped, so a NEW scheduled job cannot be born unmonitored.
// NO EXEMPTIONS. There is no allowlist here any more, and adding one back
// would be a regression rather than a convenience.
//
// This started as a burn-down list of nine legacy jobs — 13 of the ~17
// scheduled jobs had no heartbeat when the invariant was written. The list was
// keyed `file.ts#exportedJobName` rather than by file or by count, because both
// weaker forms TRANSFER: a file-level pass lets a new unmonitored job into an
// exempt file for free, and a per-file count still transfers if someone wraps
// the legacy job while adding a different unwrapped one. An exemption that can
// move to code it was never granted for is how a ratchet becomes a rubber
// stamp.
//
// All nine are wrapped now, so the list is gone and the rule is absolute:
// EVERY onSchedule() in this codebase is wrapped in withHeartbeat(). If you are
// adding a scheduled job and this test is failing, the fix is to wrap it, not
// to reintroduce a list.

/**
 * The exported job name that owns this `onSchedule(` call.
 *
 * Every scheduled job in this repo is written as `export const <name> = ...
 * onSchedule(`, so the nearest preceding `export const <name> =` identifies it.
 * Returns null when the shape does not match, which fails CLOSED — an
 * unrecognised job cannot match an exemption key and is reported as unwrapped.
 */
function owningJobName(src: string, callIndex: number): string | null {
  const before = src.slice(0, callIndex);
  const m = [...before.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=/g)].pop();
  return m ? m[1] : null;
}

/** SRC-relative, forward-slashed, so the same key works on Windows and CI. */
function relKey(srcRoot: string, file: string): string {
  return path.relative(srcRoot, file).split(path.sep).join('/');
}

/**
 * Blank out comments so a `withHeartbeat(` mentioned in PROSE cannot vouch for
 * an unwrapped job. This file is heavily commented and several of those comments
 * name the wrapper; without this, the guard could be satisfied by its own
 * documentation. Replaced with spaces rather than removed so byte offsets — and
 * therefore reported line numbers — stay exact.
 *
 * The `(?<!:)` keeps `https://` from being read as a line comment. A URL inside
 * the scanned window would otherwise blank the rest of the line, which could
 * hide a real `withHeartbeat(` and fail the test on correct code — noisy, but
 * loud, which is the safe direction for a guard to be wrong in.
 */
function blankComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

describe('every scheduled job is wrapped in withHeartbeat', () => {
  const SRC2 = path.resolve(__dirname, '..');

  function walk2(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'shared' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk2(full, acc);
      else if (e.name.endsWith('.ts')) acc.push(full);
    }
    return acc;
  }

  // onSchedule's handler is the LAST argument and the options object in between
  // can be several lines, so a fixed look-ahead window is used rather than
  // trying to parse the call. 600 chars comfortably spans every form in this
  // repo (inline cron string, options object, and multi-line options).
  //
  // The window is ALSO cut at the next onSchedule( in the file. Without that,
  // job N could be vouched for by job N+1's wrapper whenever the two sit within
  // 600 characters — a guard satisfied by a call other than the one it is
  // checking, which is the same "looks like it guards, doesn't" shape this
  // whole file exists to stop.
  const LOOKAHEAD = 600;

  /** Every unwrapped onSchedule() call, as `file.ts#jobName` plus its line. */
  const unwrappedJobs: Array<{ key: string; where: string }> = [];
  let scheduledCount = 0;

  for (const file of walk2(SRC2)) {
    // lib/heartbeat.ts documents onSchedule in prose; it defines no jobs.
    if (file.endsWith(path.join('lib', 'heartbeat.ts'))) continue;
    const src = fs.readFileSync(file, 'utf8');
    const scanned = blankComments(src);
    const starts = [...scanned.matchAll(/onSchedule\(/g)].map((m) => m.index!);
    const rel = relKey(SRC2, file);
    starts.forEach((start, i) => {
      scheduledCount++;
      const nextCall = starts[i + 1] ?? scanned.length;
      const window = scanned.slice(start, Math.min(start + LOOKAHEAD, nextCall));
      if (!window.includes('withHeartbeat(')) {
        const line = src.slice(0, start).split(String.fromCharCode(10)).length;
        const job = owningJobName(scanned, start);
        unwrappedJobs.push({
          key: `${rel}#${job ?? `<anonymous@${line}>`}`,
          where: `${rel}@${line}`,
        });
      }
    });
  }

  const unwrapped = unwrappedJobs.map((u) => `${u.key} (${u.where})`);

  it('found the scheduled jobs (guards against the regex matching nothing)', () => {
    expect(scheduledCount).toBeGreaterThanOrEqual(12);
  });

  it('leaves no onSchedule() unwrapped', () => {
    // Absolute — there is no allowlist to fall back on. Every scheduled job in
    // the codebase is wrapped, so any new one must be too.
    expect(
      unwrapped.sort(),
      'onSchedule() without withHeartbeat() — this job can die silently and nothing will say so',
    ).toEqual([]);
  });
});

// Behavioural regression for the outage that motivated the module: a job that
// ran, reported ok, then stopped producing. Distinct from the registration
// checks above — this exercises findStaleJobs itself.
describe('findStaleJobs on the real outage shape', () => {
  it('flags the finalize sweep as stale after a ten-day silence', () => {
    const TEN_DAYS = 10 * 24 * 60 * 60_000;
    const now = Date.now();
    const stale = findStaleJobs(
      { nflFinalizeSweepJob: { at: now - TEN_DAYS, ok: true } },
      { nflFinalizeSweepJob: SCHEDULED_JOB_EXPECTATIONS.nflFinalizeSweepJob },
      now,
    );
    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toBe('stale');
    expect(stale[0].ageMinutes).toBe(TEN_DAYS / 60_000);
  });
});

// The allowlist must shrink, never quietly outlive the problem. If a file on it
// gets wrapped, this fails and tells you to delete the entry — otherwise the
// list becomes a permanent blind spot of exactly the kind it documents.
// The burn-down honesty test lived here. It existed only to force the
// allowlist to shrink and to fail once an entry outlived its problem. With the
// list deleted there is nothing left for it to police — "every onSchedule() is
// wrapped" is now checked directly, with no exceptions to keep honest.

// A job can be WRAPPED and still lie. Every one of these has a catch that
// swallows so a scheduled run cannot become an unhandled rejection — and until
// this PR, that catch returned undefined, which the wrapper records as ok:true.
// Wrapping made the job stamp; it did not make the stamp truthful.
//
// This is a source-level ratchet, not a behavioural test: it cannot prove a
// verdict is CORRECT, only that a job with a swallowing catch still has some
// path that reports failure. The per-job verdict logic is inline in the job
// bodies and is not unit-tested; extracting it (as nflFinalize's
// sweepRunVerdict and nflLockWatch's lockWatchVerdict already are) is the
// follow-up. Stated plainly rather than implied, because "wrapped" and
// "actually reporting" are separate claims — the same distinction as "armed"
// and "working".
// The seven files below were wrapped in an EARLIER pass and were never given a
// failure path. They are named individually, and this list must only ever
// shrink — the same discipline as the unwrapped burn-down that this PR just
// finished closing out, applied to the invariant one level up. Note the shape
// of the problem repeating: closing "is it wrapped?" immediately exposed "does
// the wrapper get told the truth?", which is a strictly harder question and one
// that wrapping alone quietly appeared to answer.
const KNOWN_SILENT_ON_FAILURE = new Set([
  'consensus.ts',
  'espnBracket.ts',
  'expertPicks.ts',
  'expertProfiles.ts',
  'revenueAggregates.ts',
  'stripe.ts',
  'winProbability.ts',
]);

describe('a wrapped job that swallows errors still reports failure', () => {
  const SRC4 = path.resolve(__dirname, '..');

  function walk4(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'shared' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk4(full, acc);
      else if (e.name.endsWith('.ts')) acc.push(full);
    }
    return acc;
  }

  const offenders: string[] = [];
  let inspected = 0;
  for (const file of walk4(SRC4)) {
    if (file.endsWith(path.join('lib', 'heartbeat.ts'))) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('withHeartbeat(')) continue;
    inspected++;
    // `ok: false` anywhere in the file, or a shared verdict helper that returns
    // one. A file with neither cannot report a degraded run at all.
    const reportsFailure = /ok:\s*false/.test(src)
      || /configReadFailedVerdict|sweepRunVerdict|dryRunVerdict|lockWatchVerdict|scoreSyncHeartbeat/.test(src);
    const rel = relKey(SRC4, file);
    if (!reportsFailure && !KNOWN_SILENT_ON_FAILURE.has(rel)) offenders.push(rel);
  }

  it('inspected the wrapped files (guards against matching nothing)', () => {
    expect(inspected).toBeGreaterThanOrEqual(9);
  });

  it('the silent-on-failure list only names files that are still silent', () => {
    // Shrink-only. An entry that outlives its problem is a standing exemption
    // for whatever lands in that file next.
    const nowReporting = [...KNOWN_SILENT_ON_FAILURE].filter((f) => {
      const full = path.join(SRC4, f);
      if (!fs.existsSync(full)) return false;
      const src = fs.readFileSync(full, 'utf8');
      return /ok:\s*false/.test(src)
        || /configReadFailedVerdict|sweepRunVerdict|dryRunVerdict|lockWatchVerdict|scoreSyncHeartbeat/.test(src);
    }).sort();
    expect(nowReporting, 'these now report failure — remove them from KNOWN_SILENT_ON_FAILURE').toEqual([]);
  });

  it('every file defining a wrapped job can report a degraded run', () => {
    expect(
      offenders.sort(),
      'this file wraps a scheduled job but has no way to report ok:false — a ' +
        'swallowed error there stamps a HEALTHY heartbeat, which is worse than ' +
        'no heartbeat because it looks like proof of life',
    ).toEqual([]);
  });
});
