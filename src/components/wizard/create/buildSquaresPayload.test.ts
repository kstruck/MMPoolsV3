import { describe, it, expect } from 'vitest';
import { buildSquaresPayload } from './buildSquaresPayload';
import { squaresCreateInputSchema } from '@shared/schemas';
import { squaresCreateDefaults } from '@shared/squaresDefaults';

const base: Record<string, unknown> = {
  type: 'SQUARES', name: 'Big Game Squares', isPublic: true,
  homeTeam: 'Chiefs', awayTeam: 'Eagles',
  costPerSquare: 10, maxSquaresPerPlayer: 5, numberSets: '4', theme: 'default',
  managerName: '', contactEmail: '',
  paymentHandles: { venmo: '@me', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  paymentInstructions: '',
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
};

const KICKOFF = Date.UTC(2026, 10, 26, 17, 30);
const picked = {
  gameId: '401772510', gameTime: KICKOFF, league: 'nfl',
  homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers',
  homeTeamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png',
  awayTeamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png',
  seasonType: '2', week: 12,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the payload is read field by field in assertions
type Payload = Record<string, any>;

const parses = (p: unknown) => squaresCreateInputSchema.safeParse(p).success;

describe('buildSquaresPayload', () => {
  it('produces a SQUARES payload passing the schema gate', () => {
    const p = buildSquaresPayload(base) as Payload;
    expect(p.type).toBe('SQUARES');
    expect(p.name).toBe('Big Game Squares');
    expect(p.costPerSquare).toBe(10);
    expect(p.numberSets).toBe(4); // coerced select string -> number
    expect(parses(p)).toBe(true);
  });

  it('dual-writes legacy handles and coerces numeric fields', () => {
    const p = buildSquaresPayload(base) as Payload;
    expect(p.venmo).toBe('@me');
    expect(p.paymentHandles.venmo).toBe('@me');
    expect(p.maxSquaresPerPlayer).toBe(5);
  });

  it('carries top-level launch fields (estimatedPlayers + addons) the server reads for free/trial', () => {
    const p = buildSquaresPayload({
      ...base,
      estimatedPlayers: 40,
      addons: { aiCommissioner: false, smsNotifications: true, whatIfSimulator: false, customBranding: false },
    }) as Payload;
    expect(p.estimatedPlayers).toBe(40);
    expect(p.addons.smsNotifications).toBe(true);
    expect(parses(p)).toBe(true);
  });

  it('omits estimatedPlayers when blank/0 and defaults all addons to false', () => {
    const p = buildSquaresPayload(base) as Payload;
    expect('estimatedPlayers' in p).toBe(false);
    expect(p.addons).toEqual({ aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false });
  });

  it('no longer sends gridSize — the grid is always 10×10 and the contract has no such field', () => {
    const p = buildSquaresPayload({ ...base, gridSize: '10x10' });
    expect('gridSize' in p).toBe(false);
  });
});

/**
 * A LINKED GAME IS ALL OF IT OR NONE OF IT (PLAN-SQUARES-REOPEN C1).
 *
 * A pool with a `gameId` is scored from the feed. A pool with a kickoff time
 * locks itself. One without the other is a pool that is scored for you but
 * stays on sale during the game, with nothing on it saying so.
 */
describe('buildSquaresPayload — the linked game', () => {
  it('a picked game carries everything the link needs, and passes the gate', () => {
    const p = buildSquaresPayload({ ...base, ...picked }) as Payload;
    expect(p).toMatchObject(picked);
    expect(parses(p)).toBe(true);
  });

  it('and the server arms the kickoff lock from exactly that payload', () => {
    const p = buildSquaresPayload({ ...base, ...picked }) as Payload;
    const seeded = squaresCreateDefaults({ gameId: p.gameId, gameTime: p.gameTime });
    expect(seeded.reminders).toMatchObject({ lock: { enabled: true, lockAt: KICKOFF } });
  });

  it('no game picked: nothing about a game is sent', () => {
    const p = buildSquaresPayload({ ...base, gameId: '' });
    for (const k of ['gameId', 'gameTime', 'league', 'homeTeamLogo', 'awayTeamLogo', 'seasonType', 'week']) {
      expect(k in p, k).toBe(false);
    }
    // The typed names still go.
    expect(p.homeTeam).toBe('Chiefs');
    expect(parses(p)).toBe(true);
  });

  it.each([
    ['an id with no kickoff', { gameId: '401772510' }],
    ['a kickoff with no id', { gameTime: KICKOFF }],
    ['a blank id', { gameId: '   ', gameTime: KICKOFF }],
    ['a zero kickoff', { gameId: '401772510', gameTime: 0 }],
    ['a string kickoff', { gameId: '401772510', gameTime: String(KICKOFF) }],
    ['a NaN kickoff', { gameId: '401772510', gameTime: NaN }],
  ])('%s is not a link — every game field is dropped', (_label, partial) => {
    const p = buildSquaresPayload({ ...base, ...picked, gameId: undefined, gameTime: undefined, ...partial });
    for (const k of ['gameId', 'gameTime', 'league', 'homeTeamLogo', 'awayTeamLogo', 'seasonType', 'week']) {
      expect(k in p, k).toBe(false);
    }
  });

  it('"Choose a different game" leaves nothing behind', () => {
    // What `unlink` in StepSquaresGame sets: the id cleared, the rest undefined.
    const p = buildSquaresPayload({
      ...base, ...picked,
      gameId: '', gameTime: undefined, league: undefined, homeTeamLogo: undefined, awayTeamLogo: undefined, seasonType: undefined, week: undefined,
    });
    for (const k of ['gameId', 'gameTime', 'league', 'homeTeamLogo', 'awayTeamLogo', 'seasonType', 'week']) {
      expect(k in p, k).toBe(false);
    }
  });

  it('a college game is sent as college; anything else as nfl', () => {
    expect(buildSquaresPayload({ ...base, ...picked, league: 'college' }).league).toBe('college');
    expect(buildSquaresPayload({ ...base, ...picked, league: 'xfl' }).league).toBe('nfl');
    expect(buildSquaresPayload({ ...base, ...picked, league: undefined }).league).toBe('nfl');
  });

  it('a badge that is not the feed\'s own is dropped, so the create is not refused over it', () => {
    const p = buildSquaresPayload({ ...base, ...picked, homeTeamLogo: 'https://evil.example/pixel.gif', awayTeamLogo: '' });
    expect('homeTeamLogo' in p).toBe(false);
    expect('awayTeamLogo' in p).toBe(false);
    expect(p.gameId).toBe('401772510');
    expect(parses(p)).toBe(true);
  });

  it('a season type or week that is not one is dropped', () => {
    const p = buildSquaresPayload({ ...base, ...picked, seasonType: '9', week: 12.5 });
    expect('seasonType' in p).toBe(false);
    expect('week' in p).toBe(false);
    expect(parses(p)).toBe(true);
  });
});

describe('buildSquaresPayload — the payout step', () => {
  it('sends the split as squaresPayouts, never as payouts (which the server strips)', () => {
    const p = buildSquaresPayload({ ...base, squaresPayouts: { q1: 10, half: 20, q3: 10, final: 60 } }) as Payload;
    expect(p.squaresPayouts).toEqual({ q1: 10, half: 20, q3: 10, final: 60 });
    expect('payouts' in p).toBe(false);
    expect(parses(p)).toBe(true);
  });

  it('a split that does not total 100 fails the gate — it is not rounded on the way out', () => {
    const p = buildSquaresPayload({ ...base, squaresPayouts: { q1: 25, half: 25, q3: 25, final: 20 } }) as Payload;
    expect(p.squaresPayouts).toEqual({ q1: 25, half: 25, q3: 25, final: 20 });
    expect(parses(p)).toBe(false);
  });

  it('a blank box is 0, so the total is what the commissioner sees', () => {
    const p = buildSquaresPayload({ ...base, squaresPayouts: { q1: NaN, half: 50, q3: undefined, final: 50 } }) as Payload;
    expect(p.squaresPayouts).toEqual({ q1: 0, half: 50, q3: 0, final: 50 });
    expect(parses(p)).toBe(true);
  });

  it('no split in the form: none is sent, and the server uses the even split', () => {
    const p = buildSquaresPayload(base);
    expect('squaresPayouts' in p).toBe(false);
    expect(squaresCreateDefaults({ requestedPayouts: p.squaresPayouts }).payouts).toEqual({ q1: 25, half: 25, q3: 25, final: 25 });
  });

  it('charity off means off — a percentage left in the box does not ride along', () => {
    const p = buildSquaresPayload({ ...base, charity: { enabled: false, name: 'Food bank', percentage: 20 } }) as Payload;
    expect(p.charity).toEqual({ enabled: false, percentage: 0 });
    expect(parses(p)).toBe(true);
  });

  it('charity on carries the share and the trimmed name', () => {
    const p = buildSquaresPayload({ ...base, charity: { enabled: true, name: '  Food bank ', percentage: 20 } }) as Payload;
    expect(p.charity).toEqual({ enabled: true, name: 'Food bank', percentage: 20 });
    expect(parses(p)).toBe(true);
  });

  it('charity on with no name sends no name', () => {
    const p = buildSquaresPayload({ ...base, charity: { enabled: true, name: '   ', percentage: 5 } }) as Payload;
    expect(p.charity).toEqual({ enabled: true, percentage: 5 });
  });

  it('only an explicit true turns a rule on', () => {
    const on = buildSquaresPayload({
      ...base,
      ruleVariations: { reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' },
    }) as Payload;
    expect(on.ruleVariations).toEqual({ reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' });

    const off = buildSquaresPayload({
      ...base,
      ruleVariations: { reverseWinners: 'true', quarterlyRollover: 1, unclaimedFinalPrizeStrategy: 'coin flip' },
    }) as Payload;
    expect(off.ruleVariations).toEqual({ reverseWinners: false, quarterlyRollover: false, unclaimedFinalPrizeStrategy: 'last_winner' });
    expect(parses(on)).toBe(true);
    expect(parses(off)).toBe(true);
  });

  it('the rules are always sent, so a wizard pool never depends on what a missing rule reads as', () => {
    const p = buildSquaresPayload(base) as Payload;
    expect(p.ruleVariations).toEqual({ reverseWinners: false, quarterlyRollover: false, unclaimedFinalPrizeStrategy: 'last_winner' });
  });
});
