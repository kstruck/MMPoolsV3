import { describe, it, expect, vi } from 'vitest';
import { NAME_SEARCH_LIMIT, linkSquaresGame } from './linkSquaresGame';
import type { ScheduleGame } from '../services/espnSchedule';

const KICKOFF = Date.UTC(2026, 10, 26, 17, 30);
const game = (over: Partial<ScheduleGame> = {}): ScheduleGame => ({
  id: '401772510', league: 'nfl', kickoff: KICKOFF, homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers',
  homeAbbr: 'DET', awayAbbr: 'GB', homeLogo: '', awayLogo: '', state: 'pre', ...over,
});
const named = { name: 'Family squares', reminders: undefined, scores: undefined };
const free = () => true;
/** An hour before kickoff, by the clock the link is given. */
const before = () => KICKOFF - 3_600_000;
/** The server link, succeeding. Typed so `mock.calls[0]` is [gameId, league]. */
const linksOk = () => vi.fn<(gameId: string, league: 'nfl' | 'college') => Promise<unknown>>(async () => ({ linked: true }));
const namesOk = () => vi.fn<(name: string) => Promise<void>>(async () => {});
/** A callable refusal, shaped as the Firebase SDK delivers it. */
const refusal = (code: string, message: string) => Object.assign(new Error(message), { code });

const run = (over: Partial<Parameters<typeof linkSquaresGame>[0]> = {}) =>
  linkSquaresGame({ game: game(), pool: named, nameIsFree: free, link: linksOk(), saveName: namesOk(), nowMs: before, ...over });

describe('linkSquaresGame — the SERVER makes the link (PLAN-SQUARES-SERVER-FIELDS)', () => {
  it('sends only the event id and the league it was found in — nothing else about the game', async () => {
    const link = linksOk();
    expect(await run({ link })).toEqual({ status: 'linked', name: null });
    expect(link).toHaveBeenCalledTimes(1);
    expect(link.mock.calls[0]).toEqual(['401772510', 'nfl']);
  });

  it('the league is the one the game was FOUND in', async () => {
    const link = linksOk();
    await run({ game: game({ league: 'college' }), link });
    expect(link.mock.calls[0][1]).toBe('college');
  });

  it('a server refusal is "not saved", carrying the server\'s own explanation', async () => {
    for (const code of ['functions/failed-precondition', 'functions/not-found', 'functions/unavailable', 'functions/permission-denied']) {
      const link = vi.fn(async () => { throw refusal(code, 'The grid is locked. Reopen it before changing its game.'); });
      expect(await run({ link })).toEqual({ status: 'not-saved', message: 'The grid is locked. Reopen it before changing its game.' });
    }
  });

  it('a fault that is not a refusal is "not saved" with no message — internals are not shown', async () => {
    const link = vi.fn(async () => { throw refusal('functions/internal', 'TypeError at squaresAdmin.ts:812'); });
    expect(await run({ link })).toEqual({ status: 'not-saved' });
    const plain = vi.fn(async () => { throw new Error('offline'); });
    expect(await run({ link: plain })).toEqual({ status: 'not-saved' });
  });

  it('a link that throws at once is "not saved" too, not a throw', async () => {
    const link = vi.fn(() => { throw new Error('offline'); });
    await expect(run({ link })).resolves.toEqual({ status: 'not-saved' });
  });

  it('nothing is reported until the server has answered', async () => {
    let finish!: () => void;
    const link = vi.fn(() => new Promise<unknown>((res) => { finish = () => res({ linked: true }); }));
    let outcome: unknown = 'pending';
    const linking = run({ link }).then((o) => { outcome = o; });
    await new Promise((r) => setTimeout(r, 0));
    expect(outcome).toBe('pending');
    finish();
    await linking;
    expect(outcome).toEqual({ status: 'linked', name: null });
  });

  it('a game that cannot be linked is not sent', async () => {
    const link = linksOk();
    expect(await run({ game: game({ id: '' }), link })).toEqual({ status: 'not-a-game' });
    expect(await run({ game: game({ id: 'abc' }), link })).toEqual({ status: 'not-a-game' });
    expect(await run({ game: game({ kickoff: Number.NaN }), link })).toEqual({ status: 'not-a-game' });
    expect(link).not.toHaveBeenCalled();
  });
});

describe('linkSquaresGame — the pool name', () => {
  it('a pool with a name keeps it, and no name is written', async () => {
    const saveName = namesOk();
    expect(await run({ saveName })).toEqual({ status: 'linked', name: null });
    expect(saveName).not.toHaveBeenCalled();
  });

  it('a pool that never had a name takes the matchup — written AFTER the link landed', async () => {
    for (const name of [undefined, null, '', 'New Pool']) {
      const order: string[] = [];
      const link = vi.fn(async () => { order.push('link'); return { linked: true }; });
      const saveName = vi.fn(async (n: string) => { order.push(`name:${n}`); });
      const out = await run({ pool: { name }, link, saveName });
      expect(out).toEqual({ status: 'linked', name: 'Green Bay Packers @ Detroit Lions' });
      expect(order).toEqual(['link', 'name:Green Bay Packers @ Detroit Lions']);
    }
  });

  it('a refused link writes no name', async () => {
    const saveName = namesOk();
    const link = vi.fn(async () => { throw refusal('functions/unavailable', 'Could not reach the schedule.'); });
    expect((await run({ pool: {}, link, saveName })).status).toBe('not-saved');
    expect(saveName).not.toHaveBeenCalled();
  });

  it('a name write that fails leaves the pool linked, under its old name', async () => {
    const saveName = vi.fn(async () => { throw new Error('denied'); });
    expect(await run({ pool: {}, saveName })).toEqual({ status: 'linked', name: null });
  });

  it('a matchup name that is taken gets the next free number', async () => {
    const taken = new Set(['Green Bay Packers @ Detroit Lions', 'Green Bay Packers @ Detroit Lions (2)']);
    const out = await run({ pool: {}, nameIsFree: (n) => !taken.has(n) });
    expect(out).toEqual({ status: 'linked', name: 'Green Bay Packers @ Detroit Lions (3)' });
  });

  it('THE BUG: a name is never written unchecked — with every candidate taken the pool is linked and keeps its name', async () => {
    const asked: string[] = [];
    const saveName = namesOk();
    const out = await run({ pool: {}, nameIsFree: (n) => { asked.push(n); return false; }, saveName });
    expect(out).toEqual({ status: 'linked', name: null });
    expect(saveName).not.toHaveBeenCalled();
    expect(asked).toHaveLength(NAME_SEARCH_LIMIT - 1);
    expect(asked[0]).toBe('Green Bay Packers @ Detroit Lions');
    expect(asked[asked.length - 1]).toBe(`Green Bay Packers @ Detroit Lions (${NAME_SEARCH_LIMIT - 1})`);
  });

  it('the last candidate is used when it is the first free one — and it was asked about', async () => {
    const last = `Green Bay Packers @ Detroit Lions (${NAME_SEARCH_LIMIT - 1})`;
    expect(await run({ pool: {}, nameIsFree: (n) => n === last })).toEqual({ status: 'linked', name: last });
  });
});

describe('linkSquaresGame — a game that has kicked off is not sent', () => {
  it('at kickoff, by the clock it is given, nothing is sent', async () => {
    const link = linksOk();
    expect(await run({ link, nowMs: () => KICKOFF })).toEqual({ status: 'started' });
    expect(await run({ link, nowMs: () => KICKOFF + 60_000 })).toEqual({ status: 'started' });
    expect(link).not.toHaveBeenCalled();
  });

  it('a millisecond before kickoff it is sent', async () => {
    expect((await run({ nowMs: () => KICKOFF - 1 })).status).toBe('linked');
  });

  it('a game the feed says is under way is not sent, whatever the clock says', async () => {
    const link = linksOk();
    expect(await run({ game: game({ state: 'in' }), link })).toEqual({ status: 'started' });
    expect(link).not.toHaveBeenCalled();
  });

  it('it is the clock handed in that is asked, not the device\'s', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(KICKOFF + 3_600_000);            // the device thinks the game is over
      expect((await run()).status).toBe('linked');
    } finally {
      vi.useRealTimers();
    }
  });
});
