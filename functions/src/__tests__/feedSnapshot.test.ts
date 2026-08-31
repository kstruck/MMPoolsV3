import { describe, it, expect } from 'vitest';
import {
  decodeSnapshot, detectStatCorrections, encodeSnapshot, isExpired,
  MAX_SNAPSHOT_GZIP_BYTES, snapshotSlateId, SnapshotTooLargeError,
} from '../lib/feedSnapshot';
import { snapshotPointerLine } from '../feedSnapshotStore';
import { eventMatchesSeason, parseScoreboardResponse } from '../nflSchedule';
import type { NFLGame } from '../types';

// PLAN-NFL-PRESEASON-PILOT A5 — feed snapshots + stat-correction detection.

const game = (id: string, over: Partial<NFLGame> = {}): NFLGame => ({
  id, espnGameId: id, week: 1, season: '2026', seasonType: 1,
  homeTeam: { id: '1', name: 'Home', abbreviation: 'HOM', logoUrl: '' },
  awayTeam: { id: '2', name: 'Away', abbreviation: 'AWY', logoUrl: '' },
  startTime: 1_800_000_000_000, status: 'FINAL',
  scores: { home: 21, away: 17 },
  clock: '0:00', period: 4, isMonday: false,
  ...over,
} as NFLGame);

describe('encodeSnapshot / decodeSnapshot', () => {
  it('round-trips the exact payload', () => {
    const payload = { events: [{ id: '401873271', nested: { a: [1, 2, 3] } }], leagues: [{ calendar: [] }] };
    expect(decodeSnapshot(encodeSnapshot(payload).gzipped)).toEqual(payload);
  });

  it('compresses hard — a real week of scoreboard JSON must fit a Firestore doc', () => {
    // Shaped like the live 2026 preseason response: 17 events of repetitive JSON,
    // which measured 96,583 raw / 8,617 gzipped against the real ESPN endpoint.
    const payload = {
      events: Array.from({ length: 17 }, (_, i) => ({
        id: `4018732${i}`, date: '2026-08-07T00:00Z',
        status: { type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', description: 'Scheduled' } },
        competitions: [{ competitors: [{ homeAway: 'home', score: '0', team: { abbreviation: 'ARI', displayName: 'Arizona Cardinals', logo: 'https://a.espncdn.com/x.png' } }] }],
      })),
    };
    const enc = encodeSnapshot(payload);
    expect(enc.gzipBytes).toBeLessThan(enc.rawBytes / 5);
    expect(enc.gzipBytes).toBeLessThan(MAX_SNAPSHOT_GZIP_BYTES);
  });

  it('hashes content, so an unchanged response is detectable and skippable', () => {
    const a = encodeSnapshot({ x: 1 });
    expect(encodeSnapshot({ x: 1 }).sha256).toBe(a.sha256);
    expect(encodeSnapshot({ x: 2 }).sha256).not.toBe(a.sha256);
  });

  it('refuses an oversize payload rather than storing a truncated one', () => {
    // Incompressible noise, so gzip cannot rescue it.
    const big = { blob: Array.from({ length: 400_000 }, (_, i) => ((i * 2654435761) % 4294967296).toString(36)).join('') };
    expect(() => encodeSnapshot(big)).toThrow(SnapshotTooLargeError);
  });
});

describe('detectStatCorrections', () => {
  it('flags a score change on a game that was already FINAL', () => {
    const changes = detectStatCorrections(
      [game('g1')],
      [game('g1', { scores: { home: 24, away: 17 } })],
    );
    expect(changes).toEqual([{ gameId: 'g1', field: 'score', from: '17-21', to: '17-24' }]);
  });

  it('flags a FINAL game reverting to a non-final status', () => {
    const changes = detectStatCorrections([game('g1')], [game('g1', { status: 'IN_PROGRESS' })]);
    expect(changes).toEqual([{ gameId: 'g1', field: 'status', from: 'FINAL', to: 'IN_PROGRESS' }]);
  });

  it('ignores a game simply progressing — that is not a correction', () => {
    const before = [game('g1', { status: 'IN_PROGRESS', scores: { home: 7, away: 3 } })];
    const after = [game('g1', { status: 'FINAL', scores: { home: 21, away: 17 } })];
    expect(detectStatCorrections(before, after)).toEqual([]);
  });

  it('ignores an unchanged FINAL game — the common case at 5-minute cadence', () => {
    expect(detectStatCorrections([game('g1')], [game('g1')])).toEqual([]);
  });

  it('ignores a newly appearing game with no prior state', () => {
    expect(detectStatCorrections([], [game('new')])).toEqual([]);
  });

  it('does not treat scores merely going missing as a correction', () => {
    // Feed flakiness drops the field; paging for that would train ops to ignore
    // the alert that matters.
    expect(detectStatCorrections([game('g1')], [game('g1', { scores: undefined })])).toEqual([]);
  });

  it('reports every corrected game in one slate', () => {
    const changes = detectStatCorrections(
      [game('a'), game('b'), game('c')],
      [game('a', { scores: { home: 22, away: 17 } }), game('b'), game('c', { scores: { home: 21, away: 18 } })],
    );
    expect(changes.map(c => c.gameId)).toEqual(['a', 'c']);
  });
});

describe('isExpired', () => {
  const NOW = 1_800_000_000_000;
  const DAY = 86_400_000;
  it('keeps snapshots inside the retention window and drops older ones', () => {
    expect(isExpired(NOW - 10 * DAY, NOW, 45)).toBe(false);
    expect(isExpired(NOW - 46 * DAY, NOW, 45)).toBe(true);
  });
});

describe('snapshotSlateId', () => {
  it('keys by season/seasonType/week', () => {
    expect(snapshotSlateId({ season: '2026', seasonType: 1, week: 1 })).toBe('2026/1/1');
  });
});

describe('parseScoreboardResponse — real ESPN shape', () => {
  // Extracted from fetchNFLWeekSchedule by A5 so the raw payload is reachable.
  // Previously had zero test coverage. Field shapes verified against the live
  // 2026 preseason endpoint (?dates=20260803-20260817) on 2026-07-18.
  const espnEvent = (over: any = {}) => ({
    id: '401873271',
    status: { type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre' }, displayClock: '0:00', period: 0 },
    competitions: [{
      // 2026-08-07T00:00Z is CORRECT and is the captured feed value — do NOT
      // "fix" it to 08-06. The Hall of Fame game kicks off 8:00pm ET on
      // 2026-08-06, which is midnight UTC the next day. The operator docs got
      // this backwards until 2026-07-21 and dated the game 08-07; the guard
      // against that regressing lives in tests/docs-state-invariants.test.ts.
      date: '2026-08-07T00:00Z',
      competitors: [
        { homeAway: 'home', score: '0', team: { id: '22', name: 'Cardinals', abbreviation: 'ARI', logo: 'h.png' } },
        { homeAway: 'away', score: '0', team: { id: '29', name: 'Panthers', abbreviation: 'CAR', logo: 'a.png' } },
      ],
      odds: [{ details: 'CAR -1.5' }],
      ...over,
    }],
  });

  it('maps the Hall of Fame game, including the away-favorite spread convention', () => {
    const games = parseScoreboardResponse({ events: [espnEvent()] }, 1, '2026', 1);
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('espn_401873271');
    expect(games[0].homeTeam.abbreviation).toBe('ARI');
    expect(games[0].awayTeam.abbreviation).toBe('CAR');
    expect(games[0].status).toBe('SCHEDULED');
    // "CAR -1.5" with CAR away ⇒ spread relative to HOME is +1.5 (home is the dog).
    expect(games[0].spread).toEqual({ value: 1.5, locked: false });
  });

  it('negates correctly when the HOME team is favored', () => {
    const games = parseScoreboardResponse({ events: [espnEvent({ odds: [{ details: 'ARI -3.5' }] })] }, 1, '2026', 1);
    expect(games[0].spread).toEqual({ value: -3.5, locked: false });
  });

  it('maps an EVEN line to a 0 spread rather than dropping it', () => {
    const games = parseScoreboardResponse({ events: [espnEvent({ odds: [{ details: 'EVEN' }] })] }, 1, '2026', 1);
    expect(games[0].spread).toEqual({ value: 0, locked: false });
  });

  it('omits spread entirely when the feed carries no odds', () => {
    // The live preseason feed had odds on only 1 of 17 events, so this is the
    // COMMON case, not an edge case — and a game with no spread can never be
    // locked, which blocks pick submission for the whole week.
    const games = parseScoreboardResponse({ events: [espnEvent({ odds: undefined })] }, 1, '2026', 1);
    expect(games[0].spread).toBeUndefined();
  });

  /**
   * The TV listing (B1). Verified against the LIVE ESPN scoreboard on
   * 2026-08-12 before it was written: `competitions[].broadcasts[].names`.
   *
   * ⚠️ It is present on only SOME games — 11 of 16 preseason week-2 events,
   * 13 of 16 week 3, 11 of 16 week 4 — because a game carried only in its local
   * markets has no national listing. Absence is the feed's normal state, so the
   * field is omitted rather than written as an empty string, and the pick sheet
   * prints nothing rather than a placeholder.
   */
  it('captures the national broadcast when the feed carries one', () => {
    const games = parseScoreboardResponse(
      { events: [espnEvent({ broadcasts: [{ market: 'national', names: ['NFL Net'] }] })] }, 1, '2026', 1);
    expect(games[0].broadcast).toBe('NFL Net');
  });

  it('ignores LOCAL market entries — the label is the national listing', () => {
    // ESPN returns home/away market rows for local affiliates. Flattening them
    // would put one city's station on a label the pick sheet presents as the
    // national listing. (codex on this PR.)
    const games = parseScoreboardResponse({ events: [espnEvent({ broadcasts: [
      { market: 'home', names: ['KPIX 5'] },
      { market: 'away', names: ['WFAA'] },
    ] })] }, 1, '2026', 1);
    expect(games[0].broadcast).toBeNull();
  });

  it('keeps the national row when local rows sit alongside it', () => {
    const games = parseScoreboardResponse({ events: [espnEvent({ broadcasts: [
      { market: 'home', names: ['KPIX 5'] },
      { market: 'national', names: ['FOX'] },
    ] })] }, 1, '2026', 1);
    expect(games[0].broadcast).toBe('FOX');
  });

  it('joins a simulcast rather than silently keeping only the first channel', () => {
    // "CBS/Paramount+" is the honest answer; picking one drops where half the
    // audience actually watches.
    const games = parseScoreboardResponse(
      { events: [espnEvent({ broadcasts: [{ market: 'national', names: ['CBS', 'Paramount+'] }] })] }, 1, '2026', 1);
    expect(games[0].broadcast).toBe('CBS/Paramount+');
  });

  it('omits broadcast entirely on a local-market game — the COMMON case', () => {
    for (const b of [undefined, [], [{ market: 'national', names: [] }], [{ market: 'national' }]]) {
      const games = parseScoreboardResponse({ events: [espnEvent({ broadcasts: b })] }, 1, '2026', 1);
      // ⚠️ NULL, not undefined. Game writes are `merge: true` and merge keeps a
      // field the new payload omits, so omitting it would leave a stale channel
      // on a game that lost its national slot. (codex on this PR.)
      expect(games[0].broadcast).toBeNull();
    }
  });

  it('drops blank and non-string channel names rather than emitting "  " or "undefined"', () => {
    const games = parseScoreboardResponse(
      { events: [espnEvent({ broadcasts: [{ market: 'national', names: ['', '   ', null, 'FOX'] }] })] }, 1, '2026', 1);
    expect(games[0].broadcast).toBe('FOX');
  });

  it('stamps the requested week/season/seasonType, not values guessed from the payload', () => {
    const games = parseScoreboardResponse({ events: [espnEvent()] }, 3, '2026', 1);
    expect(games[0]).toMatchObject({ week: 3, season: '2026', seasonType: 1 });
  });

  it('leaves scores undefined while a game is still SCHEDULED', () => {
    const games = parseScoreboardResponse({ events: [espnEvent()] }, 1, '2026', 1);
    expect(games[0].scores).toBeUndefined();
  });

  it('leaves scores undefined when a FINAL game arrives with NO scores at all', () => {
    // safeInt maps a missing score to 0, so without this guard a partial feed
    // response would produce 0-0 on a finished game — which detectStatCorrections
    // would then page as a 21-17 → 0-0 "stat correction". The flakiness guard in
    // detectStatCorrections only works because the parser preserves undefined here.
    const ev = espnEvent();
    ev.status.type = { id: '3', name: 'STATUS_FINAL', state: 'post' } as any;
    delete (ev.competitions[0].competitors[0] as any).score;
    delete (ev.competitions[0].competitors[1] as any).score;
    const games = parseScoreboardResponse({ events: [ev] }, 1, '2026', 1);
    expect(games[0].status).toBe('FINAL');
    expect(games[0].scores).toBeUndefined();
  });

  it('still emits scores when only ONE side reported — a real 0 is preserved', () => {
    const ev = espnEvent();
    ev.status.type = { id: '3', name: 'STATUS_FINAL', state: 'post' } as any;
    ev.competitions[0].competitors[0].score = '14';
    delete (ev.competitions[0].competitors[1] as any).score;
    const games = parseScoreboardResponse({ events: [ev] }, 1, '2026', 1);
    expect(games[0].scores).toEqual({ home: 14, away: 0 });
  });

  it('preserves a genuine 0-0 final', () => {
    const ev = espnEvent();
    ev.status.type = { id: '3', name: 'STATUS_FINAL', state: 'post' } as any;
    ev.competitions[0].competitors[0].score = '0';
    ev.competitions[0].competitors[1].score = '0';
    expect(parseScoreboardResponse({ events: [ev] }, 1, '2026', 1)[0].scores).toEqual({ home: 0, away: 0 });
  });

  it('carries scores once a game is final', () => {
    const ev = espnEvent();
    ev.status.type = { id: '3', name: 'STATUS_FINAL', state: 'post' } as any;
    ev.competitions[0].competitors[0].score = '21';
    ev.competitions[0].competitors[1].score = '17';
    const games = parseScoreboardResponse({ events: [ev] }, 1, '2026', 1);
    expect(games[0].status).toBe('FINAL');
    expect(games[0].scores).toEqual({ home: 21, away: 17 });
  });

  it('skips malformed events instead of throwing the whole slate away', () => {
    const good = espnEvent();
    const noHome = espnEvent();
    noHome.competitions[0].competitors = [noHome.competitions[0].competitors[1]] as any;
    const games = parseScoreboardResponse({ events: [noHome, { id: 'x' }, good] }, 1, '2026', 1);
    expect(games.map(g => g.id)).toEqual(['espn_401873271']);
  });

  it('returns empty for a payload with no events array', () => {
    expect(parseScoreboardResponse({}, 1, '2026', 1)).toEqual([]);
    expect(parseScoreboardResponse(null, 1, '2026', 1)).toEqual([]);
  });
});

describe('eventMatchesSeason — the cross-boundary import guard', () => {
  // Root cause of the 2026-07-19 mislabel: parseScoreboardResponse stamps
  // season/seasonType/week from its ARGUMENTS, so any event the response happens
  // to include gets relabelled. ESPN's "Preseason Week 3" calendar segment runs
  // to 2026-09-09 and therefore returns the REGULAR-SEASON opener.
  const ev = (year: any, type: any) => ({ season: { year, type } }) as any;

  it('keeps an event from the requested season+type', () => {
    expect(eventMatchesSeason(ev(2026, 1), '2026', 1)).toBe(true);
  });

  it('REJECTS the regular-season opener caught by the preseason week-3 range', () => {
    // espn_401872656, NE @ SEA, 2026-09-10 — season 2026 / type 2.
    expect(eventMatchesSeason(ev(2026, 2), '2026', 1)).toBe(false);
  });

  it('REJECTS a prior-season game — the naive-URL off-season fallback', () => {
    // resolveScoreboardUrl's calendar guard is best-effort and swallows failures,
    // so the week/season URL can silently serve 2025 during the off-season.
    expect(eventMatchesSeason(ev(2025, 1), '2026', 1)).toBe(false);
  });

  it('coerces string vs number on both fields', () => {
    expect(eventMatchesSeason(ev('2026', '1'), '2026', 1)).toBe(true);
    expect(eventMatchesSeason(ev('2026', '2'), '2026', 1)).toBe(false);
  });

  it('FAILS OPEN when season is absent — degrade, do not import zero games', () => {
    // If ESPN changes shape, importing nothing looks like an outage and is worse
    // than the permissive behavior this replaced.
    expect(eventMatchesSeason({} as any, '2026', 1)).toBe(true);
    expect(eventMatchesSeason(undefined, '2026', 1)).toBe(true);
    expect(eventMatchesSeason({ season: {} } as any, '2026', 1)).toBe(true);
  });

  it('checks each field independently when only one is present', () => {
    expect(eventMatchesSeason({ season: { type: 2 } } as any, '2026', 1)).toBe(false);
    expect(eventMatchesSeason({ season: { year: 2025 } } as any, '2026', 1)).toBe(false);
    expect(eventMatchesSeason({ season: { type: 1 } } as any, '2026', 1)).toBe(true);
  });
});

describe('parseScoreboardResponse — filters cross-boundary events end to end', () => {
  const mk = (id: string, year: number, type: number) => ({
    id,
    season: { year, type },
    status: { type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [{
      date: '2026-08-14T00:00Z',
      competitors: [
        { homeAway: 'home', score: '0', team: { id: '1', name: 'H', abbreviation: 'HOM', logo: '' } },
        { homeAway: 'away', score: '0', team: { id: '2', name: 'A', abbreviation: 'AWY', logo: '' } },
      ],
    }],
  });

  it('drops the regular-season game and keeps the preseason ones', () => {
    const games = parseScoreboardResponse(
      { events: [mk('pre1', 2026, 1), mk('reg1', 2026, 2), mk('pre2', 2026, 1)] },
      4, '2026', 1,
    );
    expect(games.map(g => g.id)).toEqual(['espn_pre1', 'espn_pre2']);
  });

  it('drops prior-season games entirely', () => {
    const games = parseScoreboardResponse({ events: [mk('old', 2025, 1)] }, 1, '2026', 1);
    expect(games).toEqual([]);
  });
});

// qodo #3 on PR #392 — the snapshot pointer in a stat-correction alert.
//
// ESPN's calendar entries overlap, so a fetch for week N can return week N+1's
// games. A correction among those is reported under the week that OWNS the game,
// while the raw payload was snapshotted under the week that was FETCHED. The
// alert told the operator the payloads were "in the nfl_feed_snapshots collection
// for this slate" — pointing at a slate with nothing in it for that response.
//
// This is the one sentence in the alert somebody ACTS on mid-incident, so a
// confidently wrong pointer is worse than no pointer at all.
describe('snapshotPointerLine', () => {
  it('points at this slate when the correction was observed in its own response', () => {
    const line = snapshotPointerLine('2026/1/2', '2026/1/2');
    expect(line).toContain('for this slate');
    expect(line).not.toContain('NOT');
  });

  it('names the SOURCE slate when the correction spilled over from another week', () => {
    const line = snapshotPointerLine('2026/1/2', '2026/1/1');
    // The slate that actually holds the payload must be named...
    expect(line).toContain('under slate 2026/1/1');
    // ...and the one that does NOT must be called out, so nobody looks there.
    expect(line).toContain('NOT 2026/1/2');
    expect(line).not.toContain('for this slate');
  });
});
