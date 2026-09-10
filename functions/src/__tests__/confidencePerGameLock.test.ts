import { describe, it, expect } from 'vitest';
import { stampLockRuleVersion, needsConfidenceLockModeBackfill, LOCK_RULE_VERSION } from '../lib/lockRuleVersion';
import { confidenceModeRefusal, confidenceModeEditNeedsEntries, touchesConfidenceModeSetting } from '../lib/confidenceModeGate';
import { validatePerGameConfidence } from '../nflScoringEngine';
import { confidenceSlateFor } from '../shared/nflLockMode';
import { SERVER_OWNED_SETTINGS_KEYS, flattenSettingsPatch } from '../lib/poolUpdate';

/**
 * PLAN-CONFIDENCE-PER-GAME-LOCK — the pure pieces, unit-tested here; the
 * callable paths are in `emulator/confidencePerGame.emulator.test.ts`.
 */

describe('lockRuleVersion stamp', () => {
  it('stamps every NFL pool at creation, leaves the rest alone, is idempotent', () => {
    for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']) {
      const p: { type?: string; settings?: Record<string, unknown> } = { type, settings: { entryFee: 5 } };
      stampLockRuleVersion(p);
      expect(p.settings).toEqual({ entryFee: 5, lockRuleVersion: LOCK_RULE_VERSION });
      stampLockRuleVersion(p);
      expect(p.settings?.lockRuleVersion).toBe(LOCK_RULE_VERSION);
    }
    const squares: { type?: string; settings?: Record<string, unknown> } = { type: 'SQUARES', settings: {} };
    stampLockRuleVersion(squares);
    expect(squares.settings).toEqual({});
    const noSettings: { type?: string; settings?: Record<string, unknown> } = { type: 'NFL_PICKEM' };
    stampLockRuleVersion(noSettings);
    expect(noSettings.settings).toEqual({ lockRuleVersion: LOCK_RULE_VERSION });
  });

  it('is server-owned: a manager save carrying it is refused, like weekLockOverrides', () => {
    expect(SERVER_OWNED_SETTINGS_KEYS).toContain('lockRuleVersion');
    expect(() => flattenSettingsPatch({ settings: { lockRuleVersion: 1, entryFee: 5 } }, 'NFL_PICKEM')).toThrow(/lockRuleVersion/);
  });

  describe('backfill predicate (codex r2 #3: stored-WEEKLY legacy pools are stamped too)', () => {
    const conf = (settings: Record<string, unknown>) => ({ type: 'NFL_PICKEM', settings });
    it('matches every UNSTAMPED confidence Pick\'em pool, whatever lockMode it stores', () => {
      expect(needsConfidenceLockModeBackfill(conf({ confidenceMode: true, lockMode: 'PER_GAME' }))).toBe(true);
      expect(needsConfidenceLockModeBackfill(conf({ confidenceMode: true }))).toBe(true);
      expect(needsConfidenceLockModeBackfill(conf({ confidenceMode: true, lockMode: 'WEEKLY' }))).toBe(true);
      expect(needsConfidenceLockModeBackfill(conf({ confidenceMode: true, lockMode: 'WEEKLY', lockRuleVersion: 1 }))).toBe(true);
    });
    it('skips stamped pools, straight pools, and other types (codex r1 #4)', () => {
      expect(needsConfidenceLockModeBackfill(conf({ confidenceMode: true, lockMode: 'PER_GAME', lockRuleVersion: 2 }))).toBe(false);
      expect(needsConfidenceLockModeBackfill(conf({ confidenceMode: false, lockMode: 'PER_GAME' }))).toBe(false);
      expect(needsConfidenceLockModeBackfill(conf({}))).toBe(false);
      expect(needsConfidenceLockModeBackfill({ type: 'NFL_SURVIVOR', settings: { confidenceMode: true } })).toBe(false);
      expect(needsConfidenceLockModeBackfill(undefined)).toBe(false);
    });
  });
});

describe('confidenceMode gate (T10, codex r1 #8)', () => {
  const pool = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ type: 'NFL_PICKEM', settings, ...extra });
  const flipOn = { 'settings.confidenceMode': true };
  const flipOff = { 'settings.confidenceMode': false };

  it('only a CHANGED value is judged — the manager UI sends the key on every save', () => {
    expect(touchesConfidenceModeSetting(flipOn)).toBe(true);
    expect(touchesConfidenceModeSetting({ 'settings.entryFee': 5 })).toBe(false);
    expect(confidenceModeRefusal(pool({ confidenceMode: true }), flipOn, [{ picks: { g1: 'KC' } }])).toBeNull();
    expect(confidenceModeEditNeedsEntries(pool({ confidenceMode: true }), flipOn)).toBe(false);
    expect(confidenceModeEditNeedsEntries(pool({ confidenceMode: false }), flipOn)).toBe(true);
  });

  it('refuses once anybody has submitted; allows on an empty pool', () => {
    const r = confidenceModeRefusal(pool({ confidenceMode: false }), flipOn, [{ picks: { g1: 'KC' } }]);
    expect(r?.code).toBe('CONFIDENCE_MODE_LOCKED_AFTER_SUBMISSIONS');
    expect(confidenceModeRefusal(pool({ confidenceMode: false }), flipOn, [{ picks: {} }, undefined])).toBeNull();
    expect(confidenceModeRefusal(pool({ confidenceMode: true }), flipOff, [{ weeklyTiebreakers: { 1: 40 } }])?.code)
      .toBe('CONFIDENCE_MODE_LOCKED_AFTER_SUBMISSIONS');
  });

  it('refuses after a scored week without reading entries', () => {
    const scored = pool({ confidenceMode: false }, { scoredWeeks: { 1: true } });
    expect(confidenceModeEditNeedsEntries(scored, flipOn)).toBe(false);
    expect(confidenceModeRefusal(scored, flipOn, [])?.code).toBe('SETTINGS_LOCKED_AFTER_SCORING');
  });

  it('ignores non-Pick\'em pools', () => {
    expect(confidenceModeRefusal({ type: 'NFL_SURVIVOR', settings: {} }, flipOn, [{ picks: { 1: 'KC' } }])).toBeNull();
  });
});

describe('validatePerGameConfidence (D2 range, open-set completeness)', () => {
  const games = Array.from({ length: 16 }, (_, i) => ({ id: `g${i}`, startTime: i, status: 'SCHEDULED' }));
  const weights = (ids: string[], from: number) =>
    Object.fromEntries(ids.map((id, i) => [id, from - i])) as Record<string, number>;
  const picks = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'HOME'])) as Record<string, string>;
  const ids = games.map((g) => g.id);

  it('full open sheet, 1..16 distinct → valid', () => {
    const slate = confidenceSlateFor(games, {}, () => false);
    const merged = { picks: picks(ids), confidence: weights(ids, 16) };
    expect(validatePerGameConfidence(merged, slate, new Set(ids))).toEqual({ valid: true });
  });

  it('missed the locked opener → the 16 is gone; 15 picks weighted 1..15 pass, a 16 fails', () => {
    const locked = (g: { id: string }) => g.id === 'g0';
    const slate = confidenceSlateFor(games, {}, locked);
    expect(slate).toMatchObject({ missedIds: ['g0'], minValue: 1, maxValue: 15 });
    const open = new Set(ids.filter((id) => id !== 'g0'));
    const rest = ids.filter((id) => id !== 'g0');
    expect(validatePerGameConfidence({ picks: picks(rest), confidence: weights(rest, 15) }, slate, open)).toEqual({ valid: true });
    const withSixteen = validatePerGameConfidence({ picks: picks(rest), confidence: weights(rest, 16) }, slate, open);
    expect(withSixteen.valid).toBe(false);
    expect(withSixteen.error).toMatch(/OUT_OF_RANGE_CONFIDENCE: Value 16/);
  });

  it('an OPEN game left unpicked is INCOMPLETE (the range depends on k, which can only grow)', () => {
    const slate = confidenceSlateFor(games, {}, () => false);
    const rest = ids.slice(1);
    const r = validatePerGameConfidence({ picks: picks(rest), confidence: weights(rest, 16) }, slate, new Set(ids));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/INCOMPLETE_CONFIDENCE_SUBMISSION: Missing pick for game g0/);
  });

  it('a picked game with no weight, a duplicate, a non-integer — each refused', () => {
    const slate = confidenceSlateFor(games, {}, () => false);
    const open = new Set(ids);
    const w = weights(ids, 16);
    const noWeight = { ...w }; delete noWeight.g5;
    expect(validatePerGameConfidence({ picks: picks(ids), confidence: noWeight }, slate, open).error).toMatch(/Missing confidence value for game g5/);
    expect(validatePerGameConfidence({ picks: picks(ids), confidence: { ...w, g5: w.g6 } }, slate, open).error).toMatch(/DUPLICATE_CONFIDENCE_VALUES/);
    expect(validatePerGameConfidence({ picks: picks(ids), confidence: { ...w, g5: 5.5 } }, slate, open).error).toMatch(/OUT_OF_RANGE_CONFIDENCE/);
  });

  it('a frozen 16 survives a later miss; the open games then take 1..14 (codex r5)', () => {
    const stored = { g0: 'AWAY' };
    const locked = (g: { id: string }) => g.id === 'g0' || g.id === 'g1';
    const slate = confidenceSlateFor(games, stored, locked, { g0: 16 });
    const open = new Set(ids.slice(2));
    const rest = ids.slice(2);
    const merged = { picks: { ...picks(rest), g0: 'AWAY' }, confidence: { ...weights(rest, 14), g0: 16 } };
    expect(validatePerGameConfidence(merged, slate, open)).toEqual({ valid: true });
    // Spending the forfeited 15 on an open game is refused; the frozen 16 never is.
    const withFifteen = { picks: merged.picks, confidence: { ...merged.confidence, g2: 15 } };
    expect(validatePerGameConfidence(withFifteen, slate, open).error).toMatch(/OUT_OF_RANGE_CONFIDENCE: Value 15/);
  });

  it('a LOCKED legacy pick with no weight is grandfathered; an OPEN pick with no weight is not (codex r9)', () => {
    const stored = { g0: 'AWAY' }; // proxy pick on a legacy pool — no weight ever
    const locked = (g: { id: string }) => g.id === 'g0';
    const slate = confidenceSlateFor(games, stored, locked, {});
    const rest = ids.slice(1);
    const merged = { picks: { ...picks(rest), g0: 'AWAY' }, confidence: weights(rest, 16) };
    expect(validatePerGameConfidence(merged, slate, new Set(rest))).toEqual({ valid: true });
    const openNoWeight = { picks: merged.picks, confidence: { ...merged.confidence } };
    delete openNoWeight.confidence.g1;
    expect(validatePerGameConfidence(openNoWeight, slate, new Set(rest)).error).toMatch(/Missing confidence value for game g1/);
  });

  it('a locked game the member DID pick contributes its frozen weight and is not asked again', () => {
    const stored = { g0: 'AWAY' };
    const locked = (g: { id: string }) => g.id === 'g0';
    const slate = confidenceSlateFor(games, stored, locked);
    expect(slate).toMatchObject({ missedIds: [], minValue: 1, maxValue: 16 });
    const merged = { picks: { ...picks(ids.slice(1)), g0: 'AWAY' }, confidence: weights(ids, 16) };
    expect(validatePerGameConfidence(merged, slate, new Set(ids.slice(1)))).toEqual({ valid: true });
  });

  it('12-game week, one missed → 5..15: the TOP value is forfeited, and on a 12-game week that is the 16', () => {
    // Kevin's ruling was "they lose the highest confidence value"; his worked
    // example said "lose 12" for a 12-game week, which assumes a 1..N display.
    // The stored range has always been [17−N .. 16] (a 12-game week ranks
    // 5..16 — the help copy says "on a short week the ranks start higher"), so
    // the highest value is 16 and THAT is what a miss forfeits. Flagged to
    // Kevin in the PR; the rule implemented is "lose the top value".
    const twelve = games.slice(0, 12);
    const slate = confidenceSlateFor(twelve, {}, (g) => g.id === 'g0');
    expect(slate).toMatchObject({ minValue: 5, maxValue: 15 });
  });
});
