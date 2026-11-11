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
/** A save that goes through. Typed, so `mock.calls[0][0]` is the patch. */
const savesOk = () => vi.fn<(patch: Record<string, unknown>) => Promise<void>>(async () => {});
type LinkPatch = { gameId: string; league: string; reminders: { lock: Record<string, unknown> } };

describe('linkSquaresGame — "linked" is said only once the pool is saved', () => {
  it('a save that goes through: linked, with the game, its league and the lock at kickoff', async () => {
    const save = savesOk();
    expect(await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save, nowMs: before })).toEqual({ status: 'linked', name: null });
    expect(save).toHaveBeenCalledTimes(1);
    const patch = save.mock.calls[0][0] as unknown as LinkPatch;
    expect(patch.gameId).toBe('401772510');
    expect(patch.league).toBe('nfl');
    expect(patch.reminders.lock).toMatchObject({ enabled: true, lockAt: KICKOFF });
    expect('name' in patch).toBe(false);
  });

  // codex, PR #760: "Change Game" carried the old game's scores onto the new one.
  it('changing the game starts from fresh scores; re-linking the same game keeps them', async () => {
    // Not yet played: the old game's kickoff and a stray field, nothing scored.
    const unplayed = { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', startTime: '2026-11-20T18:00:00.000Z', leftover: 'old game' };
    const other = savesOk();
    await linkSquaresGame({ game: game(), pool: { ...named, scores: unplayed, gameId: '401770000' }, nameIsFree: free, save: other, nowMs: before });
    const fresh = (other.mock.calls[0][0] as { scores: Record<string, unknown> }).scores;
    expect('leftover' in fresh).toBe(false);
    expect(fresh.startTime).toBe(new Date(KICKOFF).toISOString());
    // The SAME game keeps its scores, played or not.
    const played = { current: { home: 24, away: 17 }, q1: null, half: null, q3: null, final: { home: 24, away: 17 }, gameStatus: 'post' };
    const same = savesOk();
    await linkSquaresGame({ game: game(), pool: { ...named, scores: played, gameId: '401772510' }, nameIsFree: free, save: same, nowMs: before });
    expect((same.mock.calls[0][0] as { scores: Record<string, unknown> }).scores.final).toEqual({ home: 24, away: 17 });
  });

  // qodo, PR #760 (re-review): a game change kept the old game's winner
  // records, any final-prize draw and the sync's per-pool score markers.
  describe('a grid that has PLAYED a game cannot be moved to another', () => {
    const OTHER = '401770000';
    const cases: Array<[string, Record<string, unknown>, number]> = [
      ['winner records exist', { gameId: OTHER }, 2],
      ['the sync kept a score history', { gameId: OTHER, scoreEvents: [{ home: 7, away: 0 }] }, 0],
      ['the scores show the game over', { gameId: OTHER, scores: { gameStatus: 'post', final: { home: 24, away: 17 } } }, 0],
      ['an unlinked pool with hand-typed points', { scores: { current: { home: 3, away: 0 } } }, 0],
    ];
    for (const [why, pool, winnerCount] of cases) {
      it(`refused when ${why} — and nothing is saved`, async () => {
        const save = savesOk();
        expect(await linkSquaresGame({ game: game(), pool: { ...named, ...pool }, winnerCount, nameIsFree: free, save, nowMs: before })).toEqual({ status: 'played' });
        expect(save).not.toHaveBeenCalled();
      });
    }
    // qodo, PR #760: the winners subscription starts empty and empties on error.
    it('winner records NOT KNOWN yet (null): a change of game waits — "not-ready", nothing saved', async () => {
      const save = savesOk();
      expect(await linkSquaresGame({ game: game(), pool: { ...named, gameId: OTHER }, winnerCount: null, nameIsFree: free, save, nowMs: before })).toEqual({ status: 'not-ready' });
      expect(save).not.toHaveBeenCalled();
    });
    it('…but re-linking the SAME game does not need them', async () => {
      const save = savesOk();
      expect((await linkSquaresGame({ game: game(), pool: { ...named, gameId: '401772510' }, winnerCount: null, nameIsFree: free, save, nowMs: before })).status).toBe('linked');
    });
    it('re-linking the SAME game on a played grid is not a change, and goes through', async () => {
      const save = savesOk();
      const out = await linkSquaresGame({ game: game(), pool: { ...named, gameId: '401772510', scoreEvents: [{ home: 7, away: 0 }] }, winnerCount: 2, nameIsFree: free, save, nowMs: before });
      expect(out.status).toBe('linked');
    });
  });

  it('the league is the one the game was FOUND in', async () => {
    const save = savesOk();
    await linkSquaresGame({ game: game({ league: 'college' }), pool: named, nameIsFree: free, save, nowMs: before });
    expect((save.mock.calls[0][0] as Record<string, unknown>).league).toBe('college');
  });

  it('THE BUG: a save that is refused is "not saved" — not a success, and not a throw', async () => {
    const save = vi.fn(async () => { throw new Error('Missing or insufficient permissions.'); });
    await expect(linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save, nowMs: before })).resolves.toEqual({ status: 'not-saved' });
  });

  it('nothing is reported until the save has finished', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((res) => { finish = res; }));
    let outcome: unknown = 'pending';
    const linking = linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save, nowMs: before }).then((o) => { outcome = o; });
    await new Promise((r) => setTimeout(r, 0));
    expect(outcome).toBe('pending');
    finish();
    await linking;
    expect(outcome).toEqual({ status: 'linked', name: null });
  });

  it('a save that fails the old-fashioned way — throwing at once — is "not saved" too', async () => {
    const save = vi.fn(() => { throw new Error('offline'); });
    expect(await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save, nowMs: before })).toEqual({ status: 'not-saved' });
  });

  it('a save that returns nothing at all still counts as saved', async () => {
    const save = vi.fn(() => undefined);
    expect((await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save, nowMs: before })).status).toBe('linked');
  });

  it('a game that cannot be linked writes nothing', async () => {
    const save = vi.fn();
    expect(await linkSquaresGame({ game: game({ id: '' }), pool: named, nameIsFree: free, save, nowMs: before })).toEqual({ status: 'not-a-game' });
    expect(await linkSquaresGame({ game: game({ id: 'abc' }), pool: named, nameIsFree: free, save, nowMs: before })).toEqual({ status: 'not-a-game' });
    expect(save).not.toHaveBeenCalled();
  });

  it('a pool with a name keeps it; one that never had a name takes the matchup', async () => {
    const save = savesOk();
    for (const name of [undefined, null, '', 'New Pool']) {
      save.mockClear();
      const out = await linkSquaresGame({ game: game(), pool: { name }, nameIsFree: free, save, nowMs: before });
      expect(out).toEqual({ status: 'linked', name: 'Green Bay Packers @ Detroit Lions' });
      expect((save.mock.calls[0][0] as Record<string, unknown>).name).toBe('Green Bay Packers @ Detroit Lions');
    }
  });

  it('a matchup name that is taken gets the next free number', async () => {
    const taken = new Set(['Green Bay Packers @ Detroit Lions', 'Green Bay Packers @ Detroit Lions (2)']);
    const save = savesOk();
    const out = await linkSquaresGame({ game: game(), pool: {}, nameIsFree: (n) => !taken.has(n), save, nowMs: before });
    expect(out).toEqual({ status: 'linked', name: 'Green Bay Packers @ Detroit Lions (3)' });
  });

  it('a refused save reports no name either — the pool was not renamed', async () => {
    const save = vi.fn(async () => { throw new Error('denied'); });
    expect(await linkSquaresGame({ game: game(), pool: {}, nameIsFree: free, save, nowMs: before })).toEqual({ status: 'not-saved' });
  });

  it('THE BUG: a name is never written unchecked — with every candidate taken the pool is linked and keeps its name', async () => {
    const asked: string[] = [];
    const save = savesOk();
    const out = await linkSquaresGame({ game: game(), pool: {}, nameIsFree: (n) => { asked.push(n); return false; }, save, nowMs: before });
    expect(out).toEqual({ status: 'linked', name: null });
    expect('name' in (save.mock.calls[0][0] as Record<string, unknown>)).toBe(false);
    // Everything it considered was asked about, and it stopped at the limit.
    expect(asked).toHaveLength(NAME_SEARCH_LIMIT - 1);
    expect(asked[0]).toBe('Green Bay Packers @ Detroit Lions');
    expect(asked[asked.length - 1]).toBe(`Green Bay Packers @ Detroit Lions (${NAME_SEARCH_LIMIT - 1})`);
  });

  it('the last candidate is used when it is the first free one — and it was asked about', async () => {
    const last = `Green Bay Packers @ Detroit Lions (${NAME_SEARCH_LIMIT - 1})`;
    const out = await linkSquaresGame({ game: game(), pool: {}, nameIsFree: (n) => n === last, save: savesOk(), nowMs: before });
    expect(out).toEqual({ status: 'linked', name: last });
  });
});

describe('linkSquaresGame — a game that has kicked off is refused by the link itself', () => {
  it('at kickoff, by the clock it is given, nothing is written', async () => {
    const save = savesOk();
    expect(await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save, nowMs: () => KICKOFF })).toEqual({ status: 'started' });
    expect(await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save, nowMs: () => KICKOFF + 60_000 })).toEqual({ status: 'started' });
    expect(save).not.toHaveBeenCalled();
  });

  it('a millisecond before kickoff it links', async () => {
    const out = await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save: savesOk(), nowMs: () => KICKOFF - 1 });
    expect(out.status).toBe('linked');
  });

  it('a game the feed says is under way is refused whatever the clock says', async () => {
    const save = savesOk();
    const out = await linkSquaresGame({ game: game({ state: 'in' }), pool: named, nameIsFree: free, save, nowMs: before });
    expect(out).toEqual({ status: 'started' });
    expect(save).not.toHaveBeenCalled();
  });

  it('it is the clock handed in that is asked, not the device\'s', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(KICKOFF + 3_600_000);            // the device thinks the game is over
      const out = await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save: savesOk(), nowMs: before });
      expect(out.status).toBe('linked');
    } finally {
      vi.useRealTimers();
    }
  });
});

