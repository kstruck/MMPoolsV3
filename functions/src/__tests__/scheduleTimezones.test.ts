import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every wall-clock schedule declares a timeZone.
 *
 * WHY. Cloud Scheduler defaults to UTC when `timeZone` is omitted. Seven
 * daily-or-slower jobs relied on that default, so a schedule reading
 * `every day 08:30` actually fired at 04:30 ET — and HANDOFF documented it as
 * 08:30 ET. That is not a bug in the job; it is a verification instruction that
 * sends an operator to look at the wrong hour, which is how a dead job gets
 * confirmed healthy.
 *
 * Kevin's ruling (2026-07-22): pin them all to ET.
 *
 * SCOPE, deliberately narrow. Only schedules with a WALL-CLOCK component are
 * checked — a cron with a fixed hour, or the `every day HH:MM` form. Interval
 * schedules fire on a period rather than at a time of day (every-5-minutes,
 * every-10-minutes-via-cron, hourly-at-15-past), so a timeZone would be noise
 * on them and demanding one would train people to add meaningless config.
 * `every 24 hours` is an interval too, which is exactly why the two jobs using
 * it had to become crons before they could be pinned at all.
 *
 * (Cron examples are spelled out in words here on purpose: a literal
 * step-syntax cron inside a block comment closes the comment early. Learned
 * the hard way while writing this file.)
 */

const SRC = path.resolve(__dirname, '..');
const TZ = 'America/New_York';

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'shared' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/** Strip comments so a schedule quoted in prose is not mistaken for a real one. */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** The text of an onSchedule(...) call, by paren matching. */
function scheduleCalls(src: string): string[] {
  const scanned = blankComments(src);
  const out: string[] = [];
  for (const m of scanned.matchAll(/onSchedule\(/g)) {
    let depth = 0;
    let i = m.index! + 'onSchedule'.length;
    for (; i < scanned.length; i++) {
      if (scanned[i] === '(') depth++;
      else if (scanned[i] === ')') { depth--; if (depth === 0) break; }
    }
    out.push(scanned.slice(m.index!, i + 1));
  }
  return out;
}

const SCHEDULE_LITERAL = /schedule:\s*['"]([^'"]+)['"]|onSchedule\(\s*['"]([^'"]+)['"]/;

/**
 * Does this schedule name a time of day?
 *
 *  - `every day HH:MM`         -> yes
 *  - a 5-field cron whose HOUR field is neither a bare star nor step syntax -> yes
 *  - anything else (intervals) -> no
 */
export function hasWallClock(schedule: string): boolean {
  if (/every day \d{1,2}:\d{2}/i.test(schedule)) return true;
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const hour = fields[1];
  return hour !== '*' && !hour.startsWith('*/');
}

const jobName = (body: string) =>
  /withHeartbeat\(\s*['"]([A-Za-z0-9_]+)['"]/.exec(body)?.[1] ?? '<unknown>';

describe('hasWallClock — the scope rule itself', () => {
  it('treats a fixed cron hour as wall-clock', () => {
    expect(hasWallClock('30 4 * * *')).toBe(true);
    expect(hasWallClock('0 9 * * 2')).toBe(true);
  });

  it('treats the every-day form as wall-clock', () => {
    expect(hasWallClock('every day 08:30')).toBe(true);
  });

  it('does NOT treat intervals as wall-clock', () => {
    // A timeZone on these would be meaningless config.
    expect(hasWallClock('*/10 * * * *')).toBe(false);
    expect(hasWallClock('15 * * * *')).toBe(false);
    expect(hasWallClock('every 5 minutes')).toBe(false);
    expect(hasWallClock('every 24 hours')).toBe(false);
  });
});

describe('every wall-clock schedule pins a timeZone', () => {
  const files = walk(SRC).filter((f) => fs.readFileSync(f, 'utf8').includes('onSchedule('));
  const clockJobs: { key: string; schedule: string; pinned: boolean; tz: string | null }[] = [];

  for (const file of files) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    for (const body of scheduleCalls(fs.readFileSync(file, 'utf8'))) {
      const m = SCHEDULE_LITERAL.exec(body);
      const schedule = m?.[1] ?? m?.[2];
      if (!schedule || !hasWallClock(schedule)) continue;
      const tz = /timeZone:\s*['"]([^'"]+)['"]/.exec(body)?.[1] ?? null;
      clockJobs.push({ key: `${rel}#${jobName(body)}`, schedule, pinned: tz !== null, tz });
    }
  }

  it('found the wall-clock jobs (guards against matching nothing)', () => {
    // Nine as of 2026-07-22. A lower number means the scanner broke, not that
    // the fleet shrank — which is the failure mode that makes a green ratchet
    // meaningless.
    expect(clockJobs.length).toBeGreaterThanOrEqual(9);
  });

  it('every one declares a timeZone', () => {
    const unpinned = clockJobs.filter((j) => !j.pinned).map((j) => `${j.key} (${j.schedule})`);
    expect(
      unpinned,
      'Cloud Scheduler defaults to UTC, so an unpinned wall-clock schedule runs at a ' +
        'different hour than it reads. Add timeZone: "America/New_York", or switch to an ' +
        'interval schedule if the time of day genuinely does not matter.',
    ).toEqual([]);
  });

  it('every one uses ET, not some other zone', () => {
    // Kevin's ruling was ET specifically. A second zone would recreate the
    // inconsistency this closed, just less visibly.
    const wrong = clockJobs.filter((j) => j.pinned && j.tz !== TZ).map((j) => `${j.key} -> ${j.tz}`);
    expect(wrong, `all wall-clock schedules must pin ${TZ}`).toEqual([]);
  });
});
