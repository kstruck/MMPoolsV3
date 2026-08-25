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
  // Keyed `file.ts#jobName`, not by file — for the same reason the wrapping
  // ratchet is: a file-level pass transfers to any NEW callback added to that
  // file, so an exemption granted for a 2026 job would silently cover whatever
  // lands beside it later. Codex caught the inconsistency between the two lists.
  //
  // adminHealth.ts#scheduledHealthCheck CAME OFF THIS LIST on 2026-08-24
  // (error-tracking audit 21c / availability audit #2). It now returns a
  // verdict: `ok: false` when an ops page it decided to send came back
  // undelivered, or when the transition-alerting block itself threw. The list
  // only ever shrinks — do not re-add it.
  'consensus.ts#consensusRefreshJob',
  'espnBracket.ts#scheduledBracketSync',
  'expertPicks.ts#syncExpertPicksJob',
  'expertProfiles.ts#gradeExpertProfilesJob',
  'revenueAggregates.ts#aggregateRevenueDaily',
  'stripe.ts#releaseStaleCouponReservations',
  'winProbability.ts#syncWinProbabilityJob',
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

  /** The text of a withHeartbeat(...) call, comments blanked, by paren match. */
  function wrappedCallBodies(src: string): string[] {
    const scanned = blankComments(src);
    const bodies: string[] = [];
    for (const m of scanned.matchAll(/withHeartbeat\(/g)) {
      let depth = 0;
      let i = m.index! + 'withHeartbeat'.length;
      for (; i < scanned.length; i++) {
        if (scanned[i] === '(') depth++;
        else if (scanned[i] === ')') { depth--; if (depth === 0) break; }
      }
      bodies.push(scanned.slice(m.index!, i + 1));
    }
    return bodies;
  }

  /** The job name a withHeartbeat(...) call was given. */
  function jobNameOf(body: string): string {
    return /withHeartbeat\(\s*['"]([A-Za-z0-9_]+)['"]/.exec(body)?.[1] ?? '<unknown>';
  }

  /**
   * Does this wrapped handler have ANY path that reports a degraded run?
   *
   * Two accepted forms: an inline `ok: false`, or a call to a `*Verdict(...)`
   * helper. The helper list used to be hardcoded, which meant every extraction
   * silently broke this ratchet until someone remembered to add the new name —
   * a guard that fails for a reason unrelated to the thing it guards. The
   * pattern is now the convention itself.
   *
   * The trade, stated plainly: this cannot tell a real verdict helper from a
   * function merely NAMED `somethingVerdict` that always reports healthy. That
   * is deliberate. This ratchet only answers "is a failure path wired up at
   * all"; whether each verdict is CORRECT is answered by the per-helper unit
   * tests, which is where that question belongs and where it is now covered.
   */
  function reportsFailure(body: string): boolean {
    return /ok:\s*false/.test(body)
      || /\b\w+Verdict\s*\(/.test(body)
      || /scoreSyncHeartbeat/.test(body);
  }

  const offenders: string[] = [];
  let inspected = 0;
  for (const file of walk4(SRC4)) {
    if (file.endsWith(path.join('lib', 'heartbeat.ts'))) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('withHeartbeat(')) continue;
    inspected++;
    // PER CALLBACK, comments blanked — not the whole file. Scanning the file
    // let an unrelated `ok: false` vouch for a handler that has none:
    // adminHealth.ts's timed() returns `{ ok: false }` for an individual probe
    // while scheduledHealthCheck itself never returns a verdict, and the file
    // scan passed it. A guard satisfied by code it is not checking is the same
    // shape as the heartbeats this whole file exists to make honest.
    const rel = relKey(SRC4, file);
    for (const body of wrappedCallBodies(src)) {
      const key = `${rel}#${jobNameOf(body)}`;
      if (KNOWN_SILENT_ON_FAILURE.has(key)) continue;
      if (!reportsFailure(body)) offenders.push(key);
    }
  }

  it('inspected the wrapped files (guards against matching nothing)', () => {
    expect(inspected).toBeGreaterThanOrEqual(9);
  });

  it('the silent-on-failure list only names files that are still silent', () => {
    // Shrink-only. An entry that outlives its problem is a standing exemption
    // for whatever lands in that file next.
    const nowReporting = [...KNOWN_SILENT_ON_FAILURE].filter((key) => {
      const [file, job] = key.split('#');
      const full = path.join(SRC4, file);
      if (!fs.existsSync(full)) return false;
      const body = wrappedCallBodies(fs.readFileSync(full, 'utf8'))
        .find((b) => jobNameOf(b) === job);
      return body !== undefined && reportsFailure(body);
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

// ---------------------------------------------------------------------------
// The registry and the cron string must agree.
//
// SCHEDULED_JOB_EXPECTATIONS is what decides whether a job is reported DEAD, and
// every entry in it is a hand-maintained copy of that job's onSchedule({
// schedule }) — the comment beside each one even quotes the cron. Nothing kept
// the copy in step with the original.
//
// Two ways that hurts, both silent:
//  - registry SLOWER than reality (10 registered, '*/5' in the code): staleness
//    is judged against 3x the registered interval, so a job dead for 25 minutes
//    still looks fresh.
//  - registry FASTER than reality: a perfectly healthy job is reported stale,
//    the monitor cries wolf, and people learn to ignore it.
//
// Written alongside nflAutoScoreJob moving '*/10' -> '*/5' for the real-time
// scoring go-live — i.e. by exactly the kind of change that desyncs them.
// ---------------------------------------------------------------------------

/**
 * Minutes between runs, from a Cloud Scheduler string, or `null` if this parser
 * does not recognise the form.
 *
 * Deliberately narrow: it handles every form present in this repo and returns
 * null on anything else. The test below FAILS on a null rather than skipping it,
 * so an unrecognised schedule is an explicit decision, never a quiet hole.
 */
export function scheduleToMinutes(schedule: string): number | null {
  const s = schedule.trim();

  // App Engine style: 'every 5 minutes', 'every 6 hours'.
  const appEngine = /^every\s+(\d+)\s+(minutes?|hours?)$/i.exec(s);
  if (appEngine) {
    const n = Number(appEngine[1]);
    return /^hour/i.test(appEngine[2]) ? n * 60 : n;
  }

  const f = s.split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;

  // Anything month- or day-of-month-scoped is not a fixed interval.
  if (dom !== '*' || mon !== '*') return null;

  const step = /^\*\/(\d+)$/.exec(min);
  if (step && hour === '*' && dow === '*') return Number(step[1]);   // '*/5 * * * *'
  if (!/^\d+$/.test(min)) return null;
  if (hour === '*' && dow === '*') return 60;                        // '15 * * * *'
  if (/^\d+$/.test(hour) && dow === '*') return 24 * 60;             // '0 3 * * *'
  if (/^\d+$/.test(hour) && /^\d+$/.test(dow)) return 7 * 24 * 60;   // '0 9 * * 2'
  return null;
}

describe('scheduleToMinutes', () => {
  it('reads the forms this repo uses', () => {
    expect(scheduleToMinutes('*/5 * * * *')).toBe(5);
    expect(scheduleToMinutes('*/10 * * * *')).toBe(10);
    expect(scheduleToMinutes('15 * * * *')).toBe(60);
    expect(scheduleToMinutes('0 3 * * *')).toBe(24 * 60);
    expect(scheduleToMinutes('0 9 * * 2')).toBe(7 * 24 * 60);
    expect(scheduleToMinutes('every 1 minutes')).toBe(1);
    expect(scheduleToMinutes('every 6 hours')).toBe(6 * 60);
  });

  // Fails CLOSED. A form it cannot read is reported, never treated as agreeing
  // with whatever the registry happens to say.
  it('returns null on a form it does not understand', () => {
    expect(scheduleToMinutes('0 0 1 * *')).toBeNull();          // monthly
    expect(scheduleToMinutes('every 3 fortnights')).toBeNull();
    expect(scheduleToMinutes('*/5 * * *')).toBeNull();          // four fields
  });
});

describe('SCHEDULED_JOB_EXPECTATIONS matches each job’s actual cron string', () => {
  const SRC5 = path.resolve(__dirname, '..');

  function walk5(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'shared' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk5(full, acc);
      else if (e.name.endsWith('.ts')) acc.push(full);
    }
    return acc;
  }

  const found: Array<{ job: string; schedule: string }> = [];
  const noSchedule: string[] = [];
  /**
   * onSchedule() calls this scan cannot attribute to an exported job name.
   *
   * They must be REPORTED, not skipped. The wrapper scan above only names an
   * anonymous job when it is ALSO unwrapped, so an anonymous-but-wrapped job
   * would appear in neither list and would silently escape the registry check —
   * exactly the "looks like it guards, doesn't" shape this file exists to stop.
   */
  const unnamed: string[] = [];

  for (const file of walk5(SRC5)) {
    // lib/heartbeat.ts documents onSchedule in prose and quotes cron strings in
    // the registry's own comments; it defines no jobs.
    if (file.endsWith(path.join('lib', 'heartbeat.ts'))) continue;
    // Scan the BLANKED text so prose cannot vouch for code, but report line
    // numbers from the RAW text.
    //
    // `blankComments` preserves byte OFFSETS — that is why the wrapper scan can
    // share indices between the two — but it does NOT preserve line breaks: a
    // multi-line block comment becomes one long run of spaces, so counting
    // newlines in the blanked text undercounts by the height of every comment
    // above the match. The wrapper scan above gets this right by slicing `src`
    // for the line and `scanned` for the offset; the first version of this scan
    // did not, and reported an `@line` that could be dozens off. Found by qodo
    // on PR #396.
    const raw = fs.readFileSync(file, 'utf8');
    const scanned5 = blankComments(raw);
    const starts = [...scanned5.matchAll(/onSchedule\(/g)].map((m) => m.index!);
    starts.forEach((start, i) => {
      const nextCall = starts[i + 1] ?? scanned5.length;
      const window = scanned5.slice(start, Math.min(start + 600, nextCall));
      const job = owningJobName(scanned5, start);
      if (!job) {
        unnamed.push(`${relKey(SRC5, file)}@${raw.slice(0, start).split(String.fromCharCode(10)).length}`);
        return;
      }
      // Either onSchedule('cron', handler) or onSchedule({ schedule: 'cron', … }, handler).
      const m = /schedule:\s*['"]([^'"]+)['"]/.exec(window)
        ?? /onSchedule\(\s*['"]([^'"]+)['"]/.exec(window);
      if (m) found.push({ job, schedule: m[1] });
      else noSchedule.push(job);
    });
  }

  it('found the schedules (guards against the regex matching nothing)', () => {
    expect(found.length).toBeGreaterThanOrEqual(12);
  });

  it('every scheduled job has a registry entry', () => {
    const missing = found
      .map((f) => f.job)
      .filter((job) => !(job in SCHEDULED_JOB_EXPECTATIONS))
      .sort();
    expect(
      missing,
      'a scheduled job with no SCHEDULED_JOB_EXPECTATIONS entry is invisible to ' +
        'the stale-job monitor — it can die and nothing will say so',
    ).toEqual([]);
  });

  it('every registered interval equals the job’s real cadence', () => {
    const drift = found
      .filter((f) => f.job in SCHEDULED_JOB_EXPECTATIONS)
      .map((f) => {
        const actual = scheduleToMinutes(f.schedule);
        const registered = SCHEDULED_JOB_EXPECTATIONS[f.job].everyMinutes;
        if (actual === null) {
          return `${f.job}: schedule '${f.schedule}' is not a form scheduleToMinutes understands`;
        }
        return actual === registered
          ? null
          : `${f.job}: runs every ${actual}min ('${f.schedule}') but is registered as ${registered}min`;
      })
      .filter((x): x is string => x !== null)
      .sort();

    expect(
      drift,
      'SCHEDULED_JOB_EXPECTATIONS has drifted from the cron strings. A registry ' +
        'SLOWER than reality lets a dead job look fresh; one FASTER makes a ' +
        'healthy job look dead. Fix the registry, or teach scheduleToMinutes the ' +
        'new form — do not delete the assertion',
    ).toEqual([]);
  });

  it('reports any onSchedule() whose schedule string could not be read', () => {
    expect(
      noSchedule.sort(),
      'this onSchedule() call has no literal schedule string within the scan ' +
        'window, so its cadence cannot be compared with the registry',
    ).toEqual([]);
  });

  it('reports any onSchedule() it cannot attribute to an exported job name', () => {
    expect(
      unnamed.sort(),
      'this onSchedule() is not preceded by `export const <name> =`, so neither ' +
        'this scan nor the wrapper scan can name it — it would escape the ' +
        'registry check entirely',
    ).toEqual([]);
  });
});
