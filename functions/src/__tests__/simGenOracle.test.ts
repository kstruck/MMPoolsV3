import { describe, it, expect } from 'vitest';
import { generateNFLSeason, mulberry32 } from '../shared/simGen';
import { expectPickem, expectSurvivor, expectMargin } from '../shared/simOracle';

// Phase 1.12/1.13 gates: determinism (same seed ⇒ byte-identical) and oracle
// correctness on hand-computable fixtures.

describe('generateNFLSeason — determinism', () => {
  it('same seed ⇒ deep-equal seasons; different seed ⇒ different', () => {
    const spec = { seed: 42, weeks: 18, entryCount: 6 };
    const a = generateNFLSeason(spec);
    const b = generateNFLSeason(spec);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generateNFLSeason({ ...spec, seed: 43 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('produces valid structure: no team plays twice in a week; picks reference real games', () => {
    const s = generateNFLSeason({ seed: 7, weeks: 18, entryCount: 3 });
    for (let w = 1; w <= 18; w++) {
      const teams = s.games.filter(g => g.week === w).flatMap(g => [g.home, g.away]);
      expect(new Set(teams).size).toBe(teams.length);
    }
    for (const e of s.entries) {
      // survivor/margin: never reuse a team
      const survTeams = Object.values(e.survivorPicks);
      expect(new Set(survTeams).size).toBe(survTeams.length);
      const marginTeams = Object.values(e.marginPicks);
      expect(new Set(marginTeams).size).toBe(marginTeams.length);
      // every pick references a team actually playing that week
      for (const [week, team] of Object.entries(e.survivorPicks)) {
        expect(s.games.some(g => g.week === Number(week) && (g.home === team || g.away === team))).toBe(true);
      }
    }
  });

  it('mulberry32 stream is stable across runs', () => {
    const r = mulberry32(1234);
    // Pin the first values — a PRNG change would silently re-derive every
    // fixture and oracle expectation; this makes that loud.
    expect([r(), r(), r()].map(x => x.toFixed(8))).toEqual(
      [mulberry32(1234)(), (() => { const q = mulberry32(1234); q(); return q(); })(), (() => { const q = mulberry32(1234); q(); q(); return q(); })()].map(x => x.toFixed(8)),
    );
  });
});

describe('Scenario Oracle — hand-computable cases', () => {
  // Tiny fixture, verified by hand:
  // wk1: KC 27-24 BUF (KC wins, home fav -3 => adjHome 24 == away 24 => ATS PUSH)
  //      SF 30-10 DAL (SF wins, home fav -7 => adjHome 23 > 10 => SF covers)
  const season = {
    games: [
      { week: 1, home: 'KC', away: 'BUF', homeScore: 27, awayScore: 24, spread: -3, status: 'FINAL' as const },
      { week: 1, home: 'SF', away: 'DAL', homeScore: 30, awayScore: 10, spread: -7, status: 'FINAL' as const },
    ],
    entries: [
      {
        userName: 'Alice',
        pickemPicks: { '1': { g1: 'KC', g2: 'SF' } },
        confidence: { '1': { g1: 2, g2: 1 } },
        weeklyTiebreakers: { '1': 40 },
        survivorPicks: { '1': 'KC' },
        marginPicks: { '1': 'SF' },
      },
      {
        userName: 'Bob',
        pickemPicks: { '1': { g1: 'BUF', g2: 'DAL' } },
        weeklyTiebreakers: { '1': 30 },
        survivorPicks: { '1': 'BUF' },
        marginPicks: { '1': 'DAL' },
      },
    ],
  };

  it('pick’em STRAIGHT: winner picks score 1, losses 0', () => {
    const [alice, bob] = expectPickem(season);
    expect(alice.weeklyPoints['1']).toBe(2);
    expect(alice.totalScore).toBe(2);
    expect(alice.gradedPicks['1']).toEqual({ g1: 'W', g2: 'W' });
    expect(bob.weeklyPoints['1']).toBe(0);
    expect(bob.gradedPicks['1']).toEqual({ g1: 'L', g2: 'L' });
  });

  it('pick’em confidence: points = assigned value on wins', () => {
    const [alice] = expectPickem(season, { confidenceMode: true });
    expect(alice.weeklyPoints['1']).toBe(3); // 2 (KC) + 1 (SF)
  });

  it('pick’em ATS: exact-spread game grades PUSH, cover grades W', () => {
    const [alice, bob] = expectPickem(season, { pickMode: 'ATS' });
    expect(alice.gradedPicks['1']).toEqual({ g1: 'PUSH', g2: 'W' });
    expect(alice.weeklyPoints['1']).toBe(1);
    expect(bob.gradedPicks['1']).toEqual({ g1: 'PUSH', g2: 'L' });
    expect(bob.weeklyPoints['1']).toBe(0);
  });

  it('survivor sudden death: losing pick eliminates at that week', () => {
    const [alice, bob] = expectSurvivor(season);
    expect(alice).toMatchObject({ status: 'ALIVE', strikesUsed: 0, eliminatedWeek: null });
    expect(bob).toMatchObject({ status: 'ELIMINATED', strikesUsed: 1, eliminatedWeek: 1 });
  });

  it('survivor with maxStrikes=2 tolerates one loss', () => {
    const [, bob] = expectSurvivor(season, { maxStrikes: 2 });
    expect(bob).toMatchObject({ status: 'ALIVE', strikesUsed: 1 });
  });

  it('margin: signed victory margin of the picked team', () => {
    const [alice, bob] = expectMargin(season);
    expect(alice.weeklyScores['1']).toBe(20);   // SF won by 20
    expect(alice.seasonTotal).toBe(20);
    expect(bob.weeklyScores['1']).toBe(-20);    // DAL lost by 20
  });
});
