import { describe, it, expect, vi } from 'vitest';
import { linkSquaresGame } from './linkSquaresGame';
import type { ScheduleGame } from '../services/espnSchedule';

const KICKOFF = Date.UTC(2026, 10, 26, 17, 30);
const game = (over: Partial<ScheduleGame> = {}): ScheduleGame => ({
  id: '401772510', league: 'nfl', kickoff: KICKOFF, homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers',
  homeAbbr: 'DET', awayAbbr: 'GB', homeLogo: '', awayLogo: '', state: 'pre', ...over,
});
const named = { name: 'Family squares', reminders: undefined, scores: undefined };
const free = () => true;

describe('linkSquaresGame — "linked" is said only once the pool is saved', () => {
  it('a save that goes through: linked, with the game, its league and the lock at kickoff', async () => {
    const save = vi.fn(async (_patch: Record<string, unknown>) => {});
    expect(await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save })).toEqual({ status: 'linked', name: null });
    expect(save).toHaveBeenCalledTimes(1);
    const patch = save.mock.calls[0][0] as Record<string, any>;
    expect(patch.gameId).toBe('401772510');
    expect(patch.league).toBe('nfl');
    expect(patch.reminders.lock).toMatchObject({ enabled: true, lockAt: KICKOFF });
    expect('name' in patch).toBe(false);
  });

  it('the league is the one the game was FOUND in', async () => {
    const save = vi.fn(async (_patch: Record<string, unknown>) => {});
    await linkSquaresGame({ game: game({ league: 'college' }), pool: named, nameIsFree: free, save });
    expect((save.mock.calls[0][0] as Record<string, unknown>).league).toBe('college');
  });

  it('THE BUG: a save that is refused is "not saved" — not a success, and not a throw', async () => {
    const save = vi.fn(async () => { throw new Error('Missing or insufficient permissions.'); });
    await expect(linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save })).resolves.toEqual({ status: 'not-saved' });
  });

  it('nothing is reported until the save has finished', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((res) => { finish = res; }));
    let outcome: unknown = 'pending';
    const linking = linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save }).then((o) => { outcome = o; });
    await new Promise((r) => setTimeout(r, 0));
    expect(outcome).toBe('pending');
    finish();
    await linking;
    expect(outcome).toEqual({ status: 'linked', name: null });
  });

  it('a save that fails the old-fashioned way — throwing at once — is "not saved" too', async () => {
    const save = vi.fn(() => { throw new Error('offline'); });
    expect(await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save })).toEqual({ status: 'not-saved' });
  });

  it('a save that returns nothing at all still counts as saved', async () => {
    const save = vi.fn(() => undefined);
    expect((await linkSquaresGame({ game: game(), pool: named, nameIsFree: free, save })).status).toBe('linked');
  });

  it('a game that cannot be linked writes nothing', async () => {
    const save = vi.fn();
    expect(await linkSquaresGame({ game: game({ id: '' }), pool: named, nameIsFree: free, save })).toEqual({ status: 'not-a-game' });
    expect(await linkSquaresGame({ game: game({ id: 'abc' }), pool: named, nameIsFree: free, save })).toEqual({ status: 'not-a-game' });
    expect(save).not.toHaveBeenCalled();
  });

  it('a pool with a name keeps it; one that never had a name takes the matchup', async () => {
    const save = vi.fn(async (_patch: Record<string, unknown>) => {});
    for (const name of [undefined, null, '', 'New Pool']) {
      save.mockClear();
      const out = await linkSquaresGame({ game: game(), pool: { name }, nameIsFree: free, save });
      expect(out).toEqual({ status: 'linked', name: 'Green Bay Packers @ Detroit Lions' });
      expect((save.mock.calls[0][0] as Record<string, unknown>).name).toBe('Green Bay Packers @ Detroit Lions');
    }
  });

  it('a matchup name that is taken gets the next free number', async () => {
    const taken = new Set(['Green Bay Packers @ Detroit Lions', 'Green Bay Packers @ Detroit Lions (2)']);
    const save = vi.fn(async (_patch: Record<string, unknown>) => {});
    const out = await linkSquaresGame({ game: game(), pool: {}, nameIsFree: (n) => !taken.has(n), save });
    expect(out).toEqual({ status: 'linked', name: 'Green Bay Packers @ Detroit Lions (3)' });
  });

  it('a refused save reports no name either — the pool was not renamed', async () => {
    const save = vi.fn(async () => { throw new Error('denied'); });
    expect(await linkSquaresGame({ game: game(), pool: {}, nameIsFree: free, save })).toEqual({ status: 'not-saved' });
  });
});
