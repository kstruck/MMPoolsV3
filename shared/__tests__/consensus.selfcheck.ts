// Runnable self-check for the pure consensus tally. `npx tsx shared/__tests__/consensus.selfcheck.ts`.
import assert from 'node:assert';
import { matchSide, pickForGame, tallyGameConsensus, mergeTally, consensusPct, type ConsensusGame } from '../consensus';

const game: ConsensusGame = { id: 'g1', week: 1, awayAbbr: 'NE', awayName: 'Patriots', homeAbbr: 'SEA', homeName: 'Seahawks' };

// matchSide: abbr + name, case-insensitive; null otherwise.
assert.strictEqual(matchSide('NE', game), 'away');
assert.strictEqual(matchSide('patriots', game), 'away');
assert.strictEqual(matchSide('SEA', game), 'home');
assert.strictEqual(matchSide('Seahawks', game), 'home');
assert.strictEqual(matchSide('DAL', game), null);
assert.strictEqual(matchSide(undefined, game), null);

// pickForGame: pick'em keys by gameId, survivor/margin key by week.
assert.strictEqual(pickForGame({ picks: { g1: 'NE' } }, game, 'NFL_PICKEM'), 'NE');
assert.strictEqual(pickForGame({ picks: { 1: 'SEA' } }, game, 'NFL_SURVIVOR'), 'SEA');
assert.strictEqual(pickForGame({ picks: {} }, game, 'NFL_PICKEM'), undefined);

// tally: count away/home; ignore non-matching / empty.
const pickem = [{ picks: { g1: 'NE' } }, { picks: { g1: 'NE' } }, { picks: { g1: 'SEA' } }, { picks: { g1: 'DAL' } }, { picks: {} }];
const t = tallyGameConsensus(pickem, game, 'NFL_PICKEM');
assert.deepStrictEqual(t, { away: 2, home: 1, total: 3 }, 'pickem tally');

const survivor = [{ picks: { 1: 'SEA' } }, { picks: { 1: 'NE' } }, { picks: { 2: 'NE' } }];
assert.deepStrictEqual(tallyGameConsensus(survivor, game, 'NFL_SURVIVOR'), { away: 1, home: 1, total: 2 }, 'survivor tally (wk2 pick ignored)');

// merge (pool shards -> site-wide) + pct.
const merged = mergeTally(t, { away: 8, home: 2, total: 10 });
assert.deepStrictEqual(merged, { away: 10, home: 3, total: 13 });
assert.deepStrictEqual(consensusPct({ away: 3, home: 1, total: 4 }), { awayPct: 75, homePct: 25 });
assert.strictEqual(consensusPct({ away: 0, home: 0, total: 0 }), null, 'no picks -> null');

console.log('consensus.selfcheck: all assertions passed');
