import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  NFL_KICKOFF_MS, SUPER_BOWL_MS, SUPER_BOWL_NUMERAL, SUPER_BOWL_TITLE,
  SEASON_TIMEZONE, milestoneLabel,
} from '../src/config/season';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * SEASON MILESTONE DATES — Kevin, 2026-08-26: *"The dates are incorrect.
 * Kickoff is Sept 9. Superbowl is Feb 14, 2027."*
 *
 * 🛑 THE DEFECT WAS NOT A WRONG STRING. IT WAS FIVE COPIES THAT DISAGREED.
 *
 * The season start was hardcoded in five places in three formats, and
 * `Countdown.tsx` — the only one that was right — ticked down to Sep 9 while
 * two milestone strips printed "Sep 10" on the same site. Asserting the new
 * values alone would not stop that happening again next season, so these tests
 * pin the SHAPE: one source, no literals left behind, labels derived rather
 * than stored.
 */
describe('season milestones are correct', () => {
  it('kickoff is Wed 9 Sep 2026, 6:20pm MDT', () => {
    const d = new Date(NFL_KICKOFF_MS);
    expect(d.toISOString()).toBe('2026-09-10T00:20:00.000Z');  // 18:20 MDT
    expect(milestoneLabel(NFL_KICKOFF_MS)).toBe('Sep 9');
  });

  it('the Super Bowl is Sun 14 Feb 2027', () => {
    expect(milestoneLabel(SUPER_BOWL_MS)).toBe('Feb 14');
    const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: SEASON_TIMEZONE });
    expect(fmt.format(new Date(SUPER_BOWL_MS))).toBe('Sunday');
  });

  it('🛑 the Super Bowl NUMERAL moved too — LX was last season', () => {
    // Super Bowl LX really was Feb 8 2026, the 2025 season. The numeral and the
    // date were a matched pair carried over, so fixing only the date would have
    // produced "Super Bowl LX — Feb 14": a NEW false statement, and one nobody
    // would have caught by checking the date.
    expect(SUPER_BOWL_NUMERAL).toBe('LXI');
    expect(SUPER_BOWL_TITLE).toBe('Super Bowl LXI');
  });
});

describe('the milestone label is DERIVED, and pinned to one timezone', () => {
  it('🛑 does not shift across midnight UTC for an eastward viewer', () => {
    // Kickoff is 00:20 UTC on the TENTH. Formatting the instant in the viewer's
    // own zone would print "Sep 10" for everyone in the UK and eastward — the
    // exact wrong string this whole change exists to remove. The label is
    // pinned to SEASON_TIMEZONE, so it reads the same everywhere.
    expect(new Date(NFL_KICKOFF_MS).toISOString().slice(0, 10)).toBe('2026-09-10');
    expect(milestoneLabel(NFL_KICKOFF_MS)).toBe('Sep 9');
    // Proof the pin is what does it: the same instant in UTC is the tenth.
    const utc = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    expect(utc.format(new Date(NFL_KICKOFF_MS))).toBe('Sep 10');
  });
});

/**
 * The anti-drift half. Every surface must read the constant; a literal date
 * left in a component is how the five copies happened.
 */
describe('no surface carries its own copy of a season date', () => {
  const SURFACES = [
    'src/components/LandingPage.tsx',
    'src/components/Countdown.tsx',
    'src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx',
    'src/components/NFLPoolDashboard/NFLManagerView.tsx',
    'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx',
  ];

  // Non-global on purpose: `.test()` on a /g regex advances `lastIndex`, so a
  // second call would answer about the wrong position.
  const HARDCODED_SEASON_DATE = /new Date\(\s*['"]202[67]-(09|02)-\d{2}/;
  const STALE_LABEL = /\b(Sep 10|Feb 8|Super Bowl LX)\b(?!I)/;

  const stripComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(new RegExp(String.raw`(^|[^:])\/\/[^\n]*`, 'g'), '$1');

  it.each(SURFACES)('%s builds no season Date of its own', file => {
    // Comments stripped first: these files now EXPLAIN the old literals in
    // prose, and a guard that fired on its own explanation would force the
    // explanation out — trading the reason for the rule.
    expect(HARDCODED_SEASON_DATE.test(stripComments(read(file)))).toBe(false);
  });

  it.each(SURFACES)('%s carries no stale milestone label', file => {
    expect(STALE_LABEL.test(stripComments(read(file)))).toBe(false);
  });

  it('🛑 BOTH regexes MATCH THE SHAPE THEY WERE WRITTEN TO CATCH', () => {
    // GUARD THE GUARD. #596 shipped a guard whose `\b` had become a literal
    // U+0008 backspace: it passed, the file was clean, and it could never have
    // matched anything. A regex that matches nothing is indistinguishable from
    // one that passes, so both are asserted against a sample they MUST catch
    // and one they must NOT.
    expect(HARDCODED_SEASON_DATE.test("const x = new Date('2026-09-10T00:00:00-06:00');")).toBe(true);
    expect(HARDCODED_SEASON_DATE.test('const x = new Date("2027-02-14T16:30:00-07:00");')).toBe(true);
    expect(HARDCODED_SEASON_DATE.test("const x = new Date('2026-08-06T00:00:00');")).toBe(false); // preseason HOF, not ours
    expect(HARDCODED_SEASON_DATE.test('const x = new Date(NFL_KICKOFF_MS);')).toBe(false);

    expect(STALE_LABEL.test('<span>Sep 10</span>')).toBe(true);
    expect(STALE_LABEL.test('<span>Feb 8</span>')).toBe(true);
    expect(STALE_LABEL.test('Super Bowl LX')).toBe(true);
    // ...and does NOT fire on the CORRECT values, including the numeral whose
    // prefix is the stale one — `LXI` starts with `LX`, which is exactly the
    // trap a naive substring check would fall into.
    expect(STALE_LABEL.test('Super Bowl LXI')).toBe(false);
    expect(STALE_LABEL.test('<span>Sep 9</span>')).toBe(false);
    expect(STALE_LABEL.test('<span>Feb 14</span>')).toBe(false);
  });

  it('the constant is the only place the instants are built', () => {
    const cfg = read('src/config/season.ts');
    expect(cfg).toContain("new Date('2026-09-09T18:20:00-06:00')");
    expect(cfg).toContain("new Date('2027-02-14T16:30:00-07:00')");
  });
});
