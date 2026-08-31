import { describe, it, expect } from 'vitest';
import {
  parityEditNeedsEntries,
  poolHasScoredWeek,
  survivorParitySettingsRefusal,
  touchesSurvivorParitySettings,
} from '../lib/survivorSettingsGate';

/**
 * PLAN-SURVIVOR-PARITY-SCORING decision 4 — the once-scored refusal.
 *
 * `computeSurvivorWeekUpdate` recomputes past weeks with the pool's CURRENT
 * settings, so a post-scoring flip of either field rewrites results members have
 * already seen, on the next rescore. UI gating cannot cover it: the callable
 * stays reachable and a super-admin bypasses the UI.
 *
 * The interesting cases are all the ones where it must NOT fire — a gate that
 * refuses ordinary saves gets removed, so the false-positive cases carry as much
 * weight here as the true ones.
 */
const survivor = (over: Record<string, unknown> = {}) => ({
  type: 'NFL_SURVIVOR',
  settings: { maxStrikes: 0, ...(over.settings as object ?? {}) },
  ...over,
});

describe('touchesSurvivorParitySettings', () => {
  it('recognises the dotted keys the flattener produces, and nothing else', () => {
    expect(touchesSurvivorParitySettings({ 'settings.tieCountsAs': 'WIN' })).toBe(true);
    expect(touchesSurvivorParitySettings({ 'settings.maxTeamUses': 2 })).toBe(true);
    expect(touchesSurvivorParitySettings({ 'settings.maxStrikes': 2 })).toBe(false);
  });
});

describe('poolHasScoredWeek', () => {
  it('is true for a TRUE publication marker', () => {
    expect(poolHasScoredWeek(survivor({ publishedWeeks: { 1: true } }))).toBe(true);
  });

  it('is FALSE for false markers — they mean unscored', () => {
    // Marker maps genuinely hold false entries (rescoreQueue). Treating them as
    // scored would freeze the settings of a pool that has never been scored.
    expect(poolHasScoredWeek(survivor({ publishedWeeks: { 1: false, 2: false } }))).toBe(false);
    expect(poolHasScoredWeek(survivor({ scoredWeeks: { 1: false } }))).toBe(false);
  });

  it('picks up LEGACY evidence a publication marker would miss', () => {
    // Weeks scored before publishedWeeks existed carry no marker at all.
    expect(poolHasScoredWeek(survivor({ scoredWeeks: { 3: true } }))).toBe(true);
    expect(poolHasScoredWeek(survivor({ scoredThroughWeek: 2 }))).toBe(true);
  });

  it('is false for a pool with no scoring evidence at all', () => {
    expect(poolHasScoredWeek(survivor())).toBe(false);
    expect(poolHasScoredWeek(undefined)).toBe(false);
  });
});

describe('survivorParitySettingsRefusal — once scored', () => {
  const scored = survivor({ publishedWeeks: { 1: true } });

  it('refuses a tieCountsAs CHANGE on a scored pool', () => {
    const r = survivorParitySettingsRefusal(scored, { 'settings.tieCountsAs': 'WIN' }, []);
    expect(r?.code).toBe('SETTINGS_LOCKED_AFTER_SCORING');
    expect(r?.field).toBe('tieCountsAs');
  });

  it('refuses a maxTeamUses CHANGE on a scored pool', () => {
    const r = survivorParitySettingsRefusal(scored, { 'settings.maxTeamUses': 2 }, []);
    expect(r?.code).toBe('SETTINGS_LOCKED_AFTER_SCORING');
  });

  it('ALLOWS a same-EFFECTIVE-value save on a scored legacy pool', () => {
    // The manager UI submits a complete settings object, so a legacy pool saving
    // the UI defaults would show `undefined -> 'LOSS'` under a naive comparison
    // and be refused for changing nothing.
    expect(survivorParitySettingsRefusal(scored, {
      'settings.tieCountsAs': 'LOSS', 'settings.maxTeamUses': 1,
    }, [])).toBeNull();
  });

  it('ALLOWS a partial unrelated save on a scored NON-default pool', () => {
    // flattenSettingsPatch applies present keys only, so an omitted field must
    // not be compared against its default and refused.
    const pool = survivor({ publishedWeeks: { 1: true }, settings: { tieCountsAs: 'WIN', maxTeamUses: 3 } });
    expect(survivorParitySettingsRefusal(pool, { 'settings.maxStrikes': 2 }, [])).toBeNull();
  });

  it('ALLOWS a change on an UNSCORED pool', () => {
    expect(survivorParitySettingsRefusal(survivor(), { 'settings.tieCountsAs': 'WIN' }, [])).toBeNull();
  });

  it('ignores non-survivor pools — the fields are inert there', () => {
    const pickem = { type: 'NFL_PICKEM', settings: {}, publishedWeeks: { 1: true } };
    expect(survivorParitySettingsRefusal(pickem, { 'settings.tieCountsAs': 'WIN' }, [])).toBeNull();
  });
});

describe('survivorParitySettingsRefusal — the reduction invariant', () => {
  const unlimited = survivor({ settings: { maxTeamUses: 0 } });
  const twice = [{ picks: { 1: 'KC', 2: 'KC', 3: 'BUF' } }];

  it('refuses 0 -> 1 while an entry has already used a team twice', () => {
    // Nothing later would catch those entries: no write touches them, so they
    // would sit permanently over a limit the pool claims to enforce.
    const r = survivorParitySettingsRefusal(unlimited, { 'settings.maxTeamUses': 1 }, twice);
    expect(r?.code).toBe('TEAM_USE_LIMIT_TOO_LOW');
    expect(r?.message).toMatch(/already picked the same team 2 times/);
  });

  it('refuses 3 -> 2 while an entry has three uses', () => {
    const pool = survivor({ settings: { maxTeamUses: 3 } });
    const thrice = [{ picks: { 1: 'KC', 2: 'KC', 5: 'KC' } }];
    expect(survivorParitySettingsRefusal(pool, { 'settings.maxTeamUses': 2 }, thrice)?.code)
      .toBe('TEAM_USE_LIMIT_TOO_LOW');
  });

  it('ALLOWS the reduction when no entry exceeds the new limit', () => {
    expect(survivorParitySettingsRefusal(unlimited, { 'settings.maxTeamUses': 2 }, twice)).toBeNull();
    expect(survivorParitySettingsRefusal(unlimited, { 'settings.maxTeamUses': 1 }, [{ picks: { 1: 'KC', 2: 'BUF' } }])).toBeNull();
  });

  it('ALLOWS an increase, and a move to unlimited, whatever the entries hold', () => {
    const two = survivor({ settings: { maxTeamUses: 2 } });
    expect(survivorParitySettingsRefusal(two, { 'settings.maxTeamUses': 5 }, twice)).toBeNull();
    expect(survivorParitySettingsRefusal(two, { 'settings.maxTeamUses': 0 }, twice)).toBeNull();
  });

  it('tolerates entries with no picks at all', () => {
    expect(survivorParitySettingsRefusal(unlimited, { 'settings.maxTeamUses': 1 }, [undefined, {}])).toBeNull();
  });

  it('checks the invariant against the FULL season, not one week', () => {
    // countTeamUses without an exclusion — a reduction cares about every week an
    // entry holds, including whichever one is current.
    const spread = [{ picks: { 1: 'KC', 9: 'KC', 17: 'KC' } }];
    expect(survivorParitySettingsRefusal(unlimited, { 'settings.maxTeamUses': 2 }, spread)?.code)
      .toBe('TEAM_USE_LIMIT_TOO_LOW');
  });
});

describe('parityEditNeedsEntries — do not read the whole pool to confirm nothing changed', () => {
  const unlimited = survivor({ settings: { maxTeamUses: 0 } });

  it('is false for the ordinary save: the UI resends the same value every time', () => {
    expect(parityEditNeedsEntries(unlimited, { 'settings.maxTeamUses': 0 })).toBe(false);
    expect(parityEditNeedsEntries(survivor(), { 'settings.maxTeamUses': 1 })).toBe(false);
  });

  it('is false when the patch does not carry the field at all', () => {
    expect(parityEditNeedsEntries(unlimited, { 'settings.tieCountsAs': 'WIN' })).toBe(false);
    expect(parityEditNeedsEntries(unlimited, { 'settings.maxStrikes': 2 })).toBe(false);
  });

  it('is false for an INCREASE or a move to unlimited — no entry can be stranded', () => {
    expect(parityEditNeedsEntries(survivor({ settings: { maxTeamUses: 2 } }), { 'settings.maxTeamUses': 5 })).toBe(false);
    expect(parityEditNeedsEntries(survivor({ settings: { maxTeamUses: 2 } }), { 'settings.maxTeamUses': 0 })).toBe(false);
  });

  it('is TRUE for a reduction to a positive limit', () => {
    expect(parityEditNeedsEntries(unlimited, { 'settings.maxTeamUses': 1 })).toBe(true);
    expect(parityEditNeedsEntries(survivor({ settings: { maxTeamUses: 3 } }), { 'settings.maxTeamUses': 2 })).toBe(true);
  });

  it('is false on a SCORED pool — the value change alone is already refused', () => {
    const scored = survivor({ publishedWeeks: { 1: true }, settings: { maxTeamUses: 0 } });
    expect(parityEditNeedsEntries(scored, { 'settings.maxTeamUses': 1 })).toBe(false);
  });

  it('is false for a non-survivor pool', () => {
    expect(parityEditNeedsEntries({ type: 'NFL_PICKEM', settings: {} }, { 'settings.maxTeamUses': 1 })).toBe(false);
  });
});
