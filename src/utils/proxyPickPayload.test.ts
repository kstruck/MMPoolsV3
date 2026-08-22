/**
 * The proxy-pick payload shape — the defect that made the Pick'em commissioner
 * proxy pick fail for its whole life.
 *
 * `NFLManagerView` sent `{ [week]: team }` for all three NFL types. Survivor
 * and Margin read that key as the week and worked. Pick'em reads every key as a
 * GAME ID (`functions/src/poolExceptions.ts`, the `NFL_PICKEM` branch) and
 * threw `Game 3 not found in week 3` — which reads like a broken schedule
 * rather than a broken payload, and is why it went unnoticed.
 *
 * `SERVER` below replays the callable's own validation loop. That is what makes
 * these tests worth anything: asserting the shape against a hand-written
 * expectation would only prove the helper agrees with this file. Replaying the
 * check the server actually runs proves the payload passes the gate that used
 * to reject it — and the same replay, fed the OLD payload, reproduces the bug.
 */

import { describe, it, expect } from 'vitest';
import {
  buildProxyTeamGameIndex,
  proxyPickPayload,
  proxyTeamOptions,
} from './proxyPickPayload';
import type { NFLGame } from '../types';

const team = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

const game = (id: string, home: string, away: string): NFLGame =>
  ({ id, week: 3, seasonType: 2, homeTeam: team(home), awayTeam: team(away) }) as unknown as NFLGame;

/** One ordinary week. */
const WEEK: NFLGame[] = [
  game('g-1', 'KC', 'BUF'),
  game('g-2', 'SF', 'DAL'),
  game('g-3', 'GB', 'CHI'),
];

const INDEX = buildProxyTeamGameIndex(WEEK);

/**
 * `poolExceptions.ts`'s NFL_PICKEM validation loop, replayed. Returns the
 * HttpsError message it would throw, or `null` when the payload is accepted.
 *
 * Kept to the two checks that decide accept/reject on shape — the lock checks
 * below them are about timing, not keys.
 */
function SERVER(picks: Record<string | number, string>, games: NFLGame[], weekNum: number): string | null {
  for (const [gameId, pickedTeam] of Object.entries(picks)) {
    const g = games.find((x) => x.id === gameId);
    if (!g) return `Game ${gameId} not found in week ${weekNum}.`;
    if (pickedTeam !== g.homeTeam.abbreviation && pickedTeam !== g.awayTeam.abbreviation) {
      return `${pickedTeam} is not playing in game ${gameId}.`;
    }
  }
  return null;
}

describe('buildProxyTeamGameIndex', () => {
  it('indexes both sides of every game', () => {
    expect(INDEX.get('KC')).toEqual(['g-1']);
    expect(INDEX.get('BUF')).toEqual(['g-1']);
    expect(INDEX.get('CHI')).toEqual(['g-3']);
    expect(INDEX.size).toBe(6);
  });

  it('offers the teams alphabetically', () => {
    expect(proxyTeamOptions(INDEX)).toEqual(['BUF', 'CHI', 'DAL', 'GB', 'KC', 'SF']);
  });

  it('ignores a game with no abbreviations rather than indexing undefined', () => {
    const index = buildProxyTeamGameIndex([{ id: 'g-x', homeTeam: {}, awayTeam: {} } as unknown as NFLGame]);
    expect(index.size).toBe(0);
  });

  /**
   * A team plays once a week, so this map should always hold exactly one id.
   * It is a LIST anyway because a duplicated fixture or a mis-imported schedule
   * would put two under one team, and collapsing to a single id here would pick
   * one silently — see the refusal test below.
   */
  it('keeps BOTH ids when a team somehow appears in two games', () => {
    const index = buildProxyTeamGameIndex([...WEEK, game('g-9', 'KC', 'DEN')]);
    expect(index.get('KC')).toEqual(['g-1', 'g-9']);
  });

  it('counts one game listed twice as one game, not a conflict', () => {
    const index = buildProxyTeamGameIndex([WEEK[0], WEEK[0]]);
    expect(index.get('KC')).toEqual(['g-1']);
  });
});

describe('proxyPickPayload — Pick’em keys by GAME ID', () => {
  it('resolves the team to the game it is playing, and the server accepts it', () => {
    const out = proxyPickPayload('NFL_PICKEM', 3, 'CHI', INDEX);
    expect(out).toEqual({ picks: { 'g-3': 'CHI' } });
    expect(SERVER((out as { picks: Record<string, string> }).picks, WEEK, 3)).toBeNull();
  });

  /**
   * THE DEFECT, REPRODUCED. The payload as it shipped, through the same replay.
   * Without this case every assertion above would also pass on a helper that
   * happened to agree with this file, and nothing would show that the old shape
   * was actually rejected.
   */
  it('the old week-keyed payload is REJECTED by the same server check', () => {
    expect(SERVER({ 3: 'CHI' }, WEEK, 3)).toBe('Game 3 not found in week 3.');
  });

  it('refuses a team that is not on this week’s slate', () => {
    const out = proxyPickPayload('NFL_PICKEM', 3, 'DEN', INDEX);
    expect(out).toEqual({ error: expect.stringContaining('DEN is not playing in week 3') });
    expect('picks' in out).toBe(false);
  });

  /**
   * The assertion the ticket asked for, made out loud rather than assumed.
   * Sending one of the two would look like it worked and record a pick against
   * a game the commissioner never chose.
   */
  it('refuses rather than guessing when a team resolves to two games', () => {
    const index = buildProxyTeamGameIndex([...WEEK, game('g-9', 'KC', 'DEN')]);
    const out = proxyPickPayload('NFL_PICKEM', 3, 'KC', index);
    expect(out).toEqual({ error: expect.stringContaining('KC appears in 2 games in week 3') });
    expect('picks' in out).toBe(false);
  });

  it('handles a week that arrives as a string', () => {
    expect(proxyPickPayload('NFL_PICKEM', '3', 'SF', INDEX)).toEqual({ picks: { 'g-2': 'SF' } });
  });
});

describe('proxyPickPayload — Survivor and Margin keep keying by WEEK', () => {
  /**
   * The half that must NOT change. Both types read `picks[weekNum]`, so
   * "fixing" them to game ids would break the two paths that have always
   * worked — which is why the switch is per pool type rather than global.
   */
  it.each(['NFL_SURVIVOR', 'NFL_MARGIN'])('%s sends the week-keyed shape', (type) => {
    expect(proxyPickPayload(type, 3, 'CHI', INDEX)).toEqual({ picks: { 3: 'CHI' } });
  });

  it('does not consult the game index at all, so an off-slate team still goes through', () => {
    // Survivor's own rules (team reuse, elimination) are the server's to judge;
    // this helper must not add a second, different opinion about which teams
    // are allowed.
    expect(proxyPickPayload('NFL_SURVIVOR', 3, 'DEN', INDEX)).toEqual({ picks: { 3: 'DEN' } });
  });

  it('an unrecognised type takes the week-keyed branch, which is today’s behaviour', () => {
    expect(proxyPickPayload(undefined, 3, 'CHI', INDEX)).toEqual({ picks: { 3: 'CHI' } });
    expect(proxyPickPayload('SQUARES', 3, 'CHI', INDEX)).toEqual({ picks: { 3: 'CHI' } });
  });

  it('the two branches genuinely differ — the switch is not a no-op', () => {
    expect(proxyPickPayload('NFL_PICKEM', 3, 'CHI', INDEX)).not.toEqual(
      proxyPickPayload('NFL_SURVIVOR', 3, 'CHI', INDEX),
    );
  });
});
