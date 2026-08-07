import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { importNFLSeason } from '../../nflSchedule';
import type { NFLGame } from '../../types';

/**
 * A partial import touches only the weeks it was asked for, and never unlocks a
 * spread.
 *
 * ## Two defects this pins, both found while diagnosing the mis-filed HOF week
 *
 * 1. THE CLEANUP DELETED THE WHOLE SEASON TYPE. `importNFLSeason` opened by
 *    deleting every game matching (season, seasonType) — ignoring `weeks`
 *    entirely — and then re-imported only the requested weeks. So
 *    `importNFLSchedule(2026, 1, weeks:[2])` would have destroyed preseason
 *    weeks 1, 3 and 4, including the Hall of Fame game, hours before kickoff.
 *    Nothing in the signature hinted at it: `weeks` reads like a filter.
 *
 * 2. IT UNLOCKED EVERY SPREAD. `parseScoreboardResponse` always emits
 *    `locked: false`, and the doc was deleted first so `merge: true` could not
 *    save it. A re-import therefore silently unlocked every line a commissioner
 *    had locked — and an ATS pool with an unlocked line refuses every pick with
 *    SPREADS_NOT_LOCKED, which is a pool nobody can enter.
 *
 * Both made re-import unusable as a repair tool, which mattered because
 * re-importing weeks 1 and 2 IS the fix for the mis-filed games.
 *
 * The fetch is injected so this exercises the real write path with no network.
 */
const db = admin.firestore();
const SEASON = 'import-scope-2026';

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

function game(id: string, week: number, away: string, home: string, spread?: { value: number; locked: boolean }): NFLGame {
  return {
    id, espnGameId: id.replace('espn_', ''), week, season: SEASON, seasonType: 1,
    startTime: Date.UTC(2026, 7, 7 + week) , status: 'SCHEDULED', clock: '0:00', period: 0, isMonday: false,
    homeTeam: T(home), awayTeam: T(away), scores: { home: 0, away: 0 },
    ...(spread ? { spread } : {}),
  } as unknown as NFLGame;
}

async function seed(games: NFLGame[]) {
  const batch = db.batch();
  for (const g of games) batch.set(db.collection('nfl_games').doc(g.id), JSON.parse(JSON.stringify(g)));
  await batch.commit();
}

async function weeksInStore(): Promise<Record<number, string[]>> {
  const snap = await db.collection('nfl_games').where('season', '==', SEASON).get();
  return snap.docs.reduce<Record<number, string[]>>((acc, d) => {
    const w = Number(d.data().week);
    (acc[w] ||= []).push(d.id);
    acc[w].sort();
    return acc;
  }, {});
}

beforeEach(async () => {
  const snap = await db.collection('nfl_games').where('season', '==', SEASON).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}, 30000);

describe('importNFLSeason — a partial import is scoped to its weeks', () => {
  it('leaves the weeks it was NOT asked to import completely alone', async () => {
    await seed([
      game('espn_w1a', 1, 'CAR', 'ARI', { value: -1.5, locked: true }),
      game('espn_w2a', 2, 'DET', 'CIN'),
      game('espn_w3a', 3, 'GB', 'PIT'),
      game('espn_w4a', 4, 'IND', 'NE'),
    ]);

    // Import week 2 ONLY. Before the fix this wiped weeks 1, 3 and 4.
    await importNFLSeason(SEASON, 1, [2], {
      fetchWeek: async () => [game('espn_w2a', 2, 'DET', 'CIN'), game('espn_w2b', 2, 'LAC', 'HOU')],
    });

    const byWeek = await weeksInStore();
    expect(byWeek[1], 'week 1 was destroyed by a week-2 import').toEqual(['espn_w1a']);
    expect(byWeek[3]).toEqual(['espn_w3a']);
    expect(byWeek[4]).toEqual(['espn_w4a']);
    expect(byWeek[2]).toEqual(['espn_w2a', 'espn_w2b']);
  }, 60000);

  it('NEVER unlocks a spread a commissioner locked', async () => {
    await seed([game('espn_w1a', 1, 'CAR', 'ARI', { value: -1.5, locked: true })]);

    // The parser always returns locked:false — that is the payload shape here.
    await importNFLSeason(SEASON, 1, [1], {
      fetchWeek: async () => [game('espn_w1a', 1, 'CAR', 'ARI', { value: -3, locked: false })],
    });

    const doc = (await db.collection('nfl_games').doc('espn_w1a').get()).data()!;
    expect(doc.spread.locked, 'a re-import unlocked a locked spread').toBe(true);
    expect(doc.spread.value, 'a locked spread was overwritten with a fresh line').toBe(-1.5);
  }, 60000);

  it('DOES refresh an unlocked spread — preservation is scoped to locked ones', async () => {
    await seed([game('espn_w1a', 1, 'CAR', 'ARI', { value: -1.5, locked: false })]);
    await importNFLSeason(SEASON, 1, [1], {
      fetchWeek: async () => [game('espn_w1a', 1, 'CAR', 'ARI', { value: -3, locked: false })],
    });
    const doc = (await db.collection('nfl_games').doc('espn_w1a').get()).data()!;
    expect(doc.spread.value).toBe(-3);
  }, 60000);

  it('removes a game the fresh fetch no longer returns, but only in scope', async () => {
    await seed([
      game('espn_w2a', 2, 'DET', 'CIN'),
      game('espn_w2gone', 2, 'XXX', 'YYY'),
      game('espn_w3a', 3, 'GB', 'PIT'),
    ]);

    await importNFLSeason(SEASON, 1, [2], {
      fetchWeek: async () => [game('espn_w2a', 2, 'DET', 'CIN')],
    });

    const byWeek = await weeksInStore();
    expect(byWeek[2], 'a cancelled fixture should be cleaned up').toEqual(['espn_w2a']);
    expect(byWeek[3], 'out-of-scope weeks must survive orphan cleanup').toEqual(['espn_w3a']);
  }, 60000);

  it('does not empty a week when the fetch returns nothing', async () => {
    // Writes happen before the orphan sweep, and a week that fetched nothing is
    // skipped — so an ESPN outage cannot delete a stored slate.
    await seed([game('espn_w2a', 2, 'DET', 'CIN')]);
    await importNFLSeason(SEASON, 1, [2], { fetchWeek: async () => [] });
    expect((await weeksInStore())[2]).toEqual(['espn_w2a']);
  }, 60000);

  it('files games by the week the FETCH returns, not the week requested', async () => {
    // The HOF-window case end to end: the week-1 query legitimately returns a
    // week-2 game, and it must land in week 2.
    await importNFLSeason(SEASON, 1, [1], {
      fetchWeek: async () => [
        game('espn_hof', 1, 'CAR', 'ARI'),
        game('espn_spill', 2, 'DET', 'CIN'),
      ],
    });
    const byWeek = await weeksInStore();
    expect(byWeek[1]).toEqual(['espn_hof']);
    expect(byWeek[2]).toEqual(['espn_spill']);
  }, 60000);

  it('does not empty a week when the response is ALL spillover', async () => {
    // A non-empty response is not proof the week was fetched. At an overlapping
    // calendar boundary ESPN can return a slate made up entirely of the NEXT
    // week's games; marking the week fetched on `games.length > 0` alone let the
    // orphan sweep delete every stored game in it. (codex r2.)
    await seed([game('espn_w2keep', 2, 'DET', 'CIN')]);

    await importNFLSeason(SEASON, 1, [2], {
      fetchWeek: async () => [game('espn_w3spill', 3, 'GB', 'PIT')],
    });

    const byWeek = await weeksInStore();
    expect(byWeek[2], 'week 2 was emptied by an all-spillover response').toEqual(['espn_w2keep']);
    expect(byWeek[3], 'the spillover game should still be written, under its own week').toEqual(['espn_w3spill']);
  }, 60000);
});
