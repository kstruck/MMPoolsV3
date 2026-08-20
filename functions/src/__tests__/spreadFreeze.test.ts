import { describe, it, expect } from 'vitest';
import {
  FREEZE_HORIZON_MS,
  MAX_GAMES_PER_FREEZE,
  chooseSlate,
  planFreeze,
  slateDocId,
  slateId,
  slateIsDue,
  slateKeysOf,
  statedCutoffBefore,
  liveFreezeAllowed,
  type FetchedGame,
  type StoredGame,
} from '../lib/spreadFreeze';

/**
 * PLAN-NFL-SPREAD-FREEZE Phase 1 — the decisions.
 *
 * Almost every case below exists because a codex round found its absence, and the
 * round number is named next to it. Three of them describe the mechanism meant to
 * ENFORCE the requirement being the thing that would have broken it, which is the
 * pattern the whole review is a record of.
 */

const DAY = 24 * 60 * 60 * 1000;
const KEY = { season: '2026', seasonType: 1, week: 4 };
const NOW = 1_700_000_000_000;

const g = (id: string, over: Partial<StoredGame> = {}): StoredGame => ({
  id, ...KEY, startTime: NOW + 2 * DAY, status: 'SCHEDULED', spread: { value: -3, locked: false }, ...over,
});

const f = (id: string, value: number | null | undefined, over: Partial<FetchedGame> = {}): FetchedGame => ({
  id, ...KEY, spread: value === undefined ? undefined : { value }, ...over,
});

describe('slateKeysOf', () => {
  it('collapses a window read into the slates it touches', () => {
    expect(
      slateKeysOf([
        { season: '2026', seasonType: 1, week: 4 },
        { season: '2026', seasonType: 1, week: 4 },
        { season: '2026', seasonType: 2, week: 1 },
      ]),
    ).toEqual([
      { season: '2026', seasonType: 1, week: 4 },
      { season: '2026', seasonType: 2, week: 1 },
    ]);
  });

  it('drops a game whose slate fields are unusable rather than inventing a slate', () => {
    expect(slateKeysOf([{ season: '', seasonType: 1, week: 4 } as never])).toEqual([]);
    expect(slateKeysOf([{ season: '2026', seasonType: NaN, week: 4 } as never])).toEqual([]);
  });
});

describe('slateIsDue', () => {
  it('is due when the first kickoff is ahead and inside the horizon', () => {
    expect(slateIsDue([g('a'), g('b', { startTime: NOW + 4 * DAY })], NOW, false)).toMatchObject({
      due: true, firstKickoffMs: NOW + 2 * DAY,
    });
  });

  it('A SLATE IS FREEZABLE EXACTLY ONCE (codex round 7)', () => {
    // The original rule was "the earliest slate not already FULLY locked", which a
    // slate with fifteen frozen games and one late addition satisfies — and the
    // pass would then rewrite all sixteen at a second instant with whatever ESPN
    // said at that moment. One frozen record puts the whole slate off-limits.
    expect(slateIsDue([g('a')], NOW, true)).toMatchObject({ due: false, reason: 'already frozen' });
  });

  it('THE HORIZON IS NOT DECORATION (codex round 8)', () => {
    // Without it, once week N carries a frozen record "the earliest unfrozen
    // slate" is week N+1 — frozen roughly nine days early, at a Tuesday that is
    // not that week's stated cutoff, on lines that will move all week. And the
    // once-only rule would make that permanent.
    const nextWeek = [g('a', { week: 5, startTime: NOW + 9 * DAY })];
    expect(slateIsDue(nextWeek, NOW, false)).toMatchObject({ due: false });
    expect(slateIsDue(nextWeek, NOW, false).reason).toContain('freeze horizon');
    // Exactly on the boundary is still inside it.
    expect(slateIsDue([g('a', { startTime: NOW + FREEZE_HORIZON_MS })], NOW, false).due).toBe(true);
  });

  it('refuses a slate whose first kickoff has already passed', () => {
    expect(slateIsDue([g('a', { startTime: NOW - 1 })], NOW, false)).toMatchObject({
      due: false, reason: 'first kickoff has passed',
    });
  });

  it('measures the FULL slate, so a late Monday game cannot drag a Thursday slate past the horizon', () => {
    const slate = [g('thu', { startTime: NOW + 2 * DAY }), g('mon', { startTime: NOW + 20 * DAY })];
    expect(slateIsDue(slate, NOW, false)).toMatchObject({ due: true, firstKickoffMs: NOW + 2 * DAY });
  });

  it('says so rather than throwing on an empty or timeless slate', () => {
    expect(slateIsDue([], NOW, false).due).toBe(false);
    expect(slateIsDue([g('a', { startTime: NaN })], NOW, false).due).toBe(false);
  });
});

describe('chooseSlate', () => {
  const v = (kickoff: number, due = true) => ({ due, reason: due ? 'due' : 'no', firstKickoffMs: kickoff });

  it('takes the EARLIEST due slate', () => {
    const chosen = chooseSlate([
      { key: { ...KEY, week: 6 }, verdict: v(NOW + 6 * DAY) },
      { key: { ...KEY, week: 4 }, verdict: v(NOW + 2 * DAY) },
    ]);
    expect(chosen?.key.week).toBe(4);
  });

  it('ignores slates that are not due, even when they kick off sooner', () => {
    const chosen = chooseSlate([
      { key: { ...KEY, week: 3 }, verdict: v(NOW + 1 * DAY, false) },
      { key: { ...KEY, week: 4 }, verdict: v(NOW + 2 * DAY) },
    ]);
    expect(chosen?.key.week).toBe(4);
  });

  it('returns null when nothing is due — the normal state of a Tuesday in February', () => {
    expect(chooseSlate([{ key: KEY, verdict: v(NOW, false) }])).toBeNull();
    expect(chooseSlate([])).toBeNull();
  });
});

describe('planFreeze — all-or-nothing over the STORED slate', () => {
  it('takes the feed value for every game when the feed carries them all', () => {
    const plan = planFreeze(KEY, [g('a'), g('b')], [f('a', -6.5), f('b', 2)]);
    expect(plan).toEqual({
      ok: true,
      writes: [
        { gameId: 'a', value: -6.5, from: 'feed' },
        { gameId: 'b', value: 2, from: 'feed' },
      ],
    });
  });

  it('REFUSES A 15-OF-16 RESPONSE AND WRITES NOTHING (codex round 9)', () => {
    // Checking "every FETCHED game has a line" passes here: fifteen get written
    // and the stored sixteenth stays unfrozen — a partially frozen week that looks
    // complete to the job that made it.
    const stored = Array.from({ length: 16 }, (_, i) => g(`g${i}`));
    const fetched = stored.slice(0, 15).map((s) => f(s.id, -3));
    const plan = planFreeze(KEY, stored, fetched);
    expect(plan.ok).toBe(false);
    expect((plan as { missingFromFetch: string[] }).missingFromFetch).toEqual(['g15']);
  });

  it('refuses when the fetch carries a game the slate does not', () => {
    const plan = planFreeze(KEY, [g('a')], [f('a', -3), f('zz', -1)]);
    expect(plan.ok).toBe(false);
    expect((plan as { unexpectedInFetch: string[] }).unexpectedInFetch).toEqual(['zz']);
  });

  it('IGNORES A NEIGHBOURING SLATE IN THE SAME RESPONSE', () => {
    // `parseScoreboardResponse` stamps `week: eventWeekNumber(event, week)` —
    // ESPN's own answer wins — and the scoreboard endpoint is unreliable about
    // which slate it returns (an import of one week returned 20 events spanning
    // two, measured 2026-08-19). Reconciling the raw response would report the
    // other week's games as unexpected and refuse EVERY Tuesday.
    const plan = planFreeze(KEY, [g('a')], [f('a', -3), f('next', -7, { week: 5 })]);
    expect(plan).toEqual({ ok: true, writes: [{ gameId: 'a', value: -3, from: 'feed' }] });
  });

  it('FALLS BACK TO THE STORED WORKING LINE PER GAME — the manual backstop (codex round 4 on the revision)', () => {
    // The freeze fetches ESPN and the override only corrects a record that already
    // exists, so without this there is nothing that turns operator-entered values
    // into frozen records — and a gap week blocks ATS submission indefinitely, with
    // the backstop that has carried every week so far quietly removed. This is the
    // 14-of-16 case the plan names.
    const stored = [g('a'), g('b', { spread: { value: 1.5, locked: false } })];
    const fetched = [f('a', -6.5), f('b', undefined)];
    expect(planFreeze(KEY, stored, fetched)).toEqual({
      ok: true,
      writes: [
        { gameId: 'a', value: -6.5, from: 'feed' },
        { gameId: 'b', value: 1.5, from: 'working' },
      ],
    });
  });

  it('refuses when a game has neither a feed line nor a working line, and names it', () => {
    const stored = [g('a'), g('b', { spread: undefined })];
    const plan = planFreeze(KEY, stored, [f('a', -3), f('b', undefined)]);
    expect(plan.ok).toBe(false);
    expect((plan as { noLine: string[] }).noLine).toEqual(['b']);
  });

  it('treats a 0 line as a real pick-em line, from either source', () => {
    expect(planFreeze(KEY, [g('a')], [f('a', 0)])).toMatchObject({
      writes: [{ gameId: 'a', value: 0, from: 'feed' }],
    });
    expect(planFreeze(KEY, [g('a', { spread: { value: 0, locked: false } })], [f('a', undefined)])).toMatchObject({
      writes: [{ gameId: 'a', value: 0, from: 'working' }],
    });
  });

  it('treats a null feed line as no line and falls through to the working one', () => {
    expect(planFreeze(KEY, [g('a')], [f('a', null)])).toMatchObject({
      writes: [{ gameId: 'a', value: -3, from: 'working' }],
    });
  });

  it('refuses an empty fetch outright rather than freezing the working lines alone', () => {
    // `fetchNFLWeekSchedule` returns [] on a failed fetch as well as on a genuinely
    // empty slate, and the two are indistinguishable here. Refusing covers both:
    // you do not freeze a week on a fetch that did not happen.
    const plan = planFreeze(KEY, [g('a')], []);
    expect(plan.ok).toBe(false);
    expect((plan as { missingFromFetch: string[] }).missingFromFetch).toEqual(['a']);
  });

  it('REFUSES rather than truncating past the per-freeze cap', () => {
    // Truncating is the partial-freeze failure wearing a different hat (1.4).
    const stored = Array.from({ length: MAX_GAMES_PER_FREEZE + 1 }, (_, i) => g(`g${i}`));
    const plan = planFreeze(KEY, stored, stored.map((s) => f(s.id, -3)));
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toContain('refusing rather than truncating');
  });

  it('refuses an empty stored slate', () => {
    expect(planFreeze(KEY, [], []).ok).toBe(false);
  });
});

describe('slate keys', () => {
  it('slateId matches nflLockWatch; slateDocId is the same key as a document name', () => {
    expect(slateId(KEY)).toBe('2026/1/4');
    // A Firestore document id may not contain `/`.
    expect(slateDocId(KEY)).toBe('2026_1_4');
    expect(slateDocId(KEY)).not.toContain('/');
  });
});

describe('statedCutoffBefore — the promise members were given', () => {
  // 1.6 promises a day and a time: Tuesday 09:00 America/New_York. Everything
  // below is that instant expressed in UTC, so the DST cases are visible.
  const TUE_AUG_25_09_ET = Date.UTC(2026, 7, 25, 13); // EDT, UTC-4
  const TUE_NOV_03_09_ET = Date.UTC(2026, 10, 3, 14); // EST, UTC-5

  it('finds the Tuesday before a Thursday kickoff', () => {
    const thu = Date.UTC(2026, 7, 27, 23); // 2026-08-27 19:00 ET, the real wk-4 opener
    expect(statedCutoffBefore(thu)).toBe(TUE_AUG_25_09_ET);
  });

  it('HANDLES THE DST CHANGEOVER, which is why this is not `- 2 * DAY`', () => {
    // DST ends 2026-11-01, so the November cutoff is 14:00Z and the August one is
    // 13:00Z. A fixed offset — or a single-pass offset correction — lands an hour
    // out on exactly the weeks a mistake is least visible.
    const thu = Date.UTC(2026, 10, 5, 23);
    expect(statedCutoffBefore(thu)).toBe(TUE_NOV_03_09_ET);
    expect(TUE_NOV_03_09_ET - TUE_AUG_25_09_ET).not.toBe(70 * 24 * 60 * 60 * 1000);
  });

  it('goes back a full week when the kickoff is Tuesday MORNING', () => {
    const tueEarly = Date.UTC(2026, 7, 25, 12); // 08:00 ET, an hour before the cutoff
    expect(statedCutoffBefore(tueEarly)).toBe(Date.UTC(2026, 7, 18, 13));
  });

  it('takes the same day when the kickoff is Tuesday AFTERNOON', () => {
    expect(statedCutoffBefore(Date.UTC(2026, 7, 25, 20))).toBe(TUE_AUG_25_09_ET);
  });

  it('degrades to "the cutoff has passed" on a malformed instant rather than blocking a repair', () => {
    expect(statedCutoffBefore(NaN)).toBe(Number.NEGATIVE_INFINITY);
    expect(liveFreezeAllowed(NaN, Date.UTC(2026, 7, 25, 14)).allowed).toBe(true);
  });
});

describe('liveFreezeAllowed', () => {
  const thu = Date.UTC(2026, 7, 27, 23);

  it('ALLOWS the scheduled run, which fires exactly AT the cutoff', () => {
    expect(liveFreezeAllowed(thu, Date.UTC(2026, 7, 25, 13)).allowed).toBe(true);
  });

  it('allows a repair later the same Tuesday, and on the days after it', () => {
    expect(liveFreezeAllowed(thu, Date.UTC(2026, 7, 25, 18)).allowed).toBe(true);
    expect(liveFreezeAllowed(thu, Date.UTC(2026, 7, 26, 15)).allowed).toBe(true);
  });

  it('REFUSES an early live freeze — the case that breaks the promise', () => {
    // A live manual run on the Sunday before would commit the slate permanently,
    // and the Tuesday job would then skip it as already frozen: the stated instant
    // quietly not honoured, by the tool built to repair it (codex r6 on PR 2).
    expect(liveFreezeAllowed(thu, Date.UTC(2026, 7, 23, 18)).allowed).toBe(false);
    // One minute before the cutoff is still before it.
    expect(liveFreezeAllowed(thu, Date.UTC(2026, 7, 25, 12, 59)).allowed).toBe(false);
  });
});
