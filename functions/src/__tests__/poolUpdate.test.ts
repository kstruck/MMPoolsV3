import { describe, it, expect } from 'vitest';
import {
  buildPoolSettingsUpdate,
  flattenSettingsPatch,
  touchesLockSettings,
  SERVER_OWNED_SETTINGS_KEYS,
  LOCK_AFFECTING_SETTINGS_KEYS,
} from '../lib/poolUpdate';
import { normalizePhase, isGroupEditable, classifyUpdateKey } from '../shared/editability';

describe('normalizePhase', () => {
  it('locked wins over status', () => {
    expect(normalizePhase({ isLocked: true, status: 'OPEN' })).toBe('locked');
  });
  it('maps status vocab', () => {
    expect(normalizePhase({ status: 'DRAFT' })).toBe('draft');
    expect(normalizePhase({ status: 'archived' })).toBe('archived');
    expect(normalizePhase({ status: 'active' })).toBe('open');
    expect(normalizePhase({})).toBe('open');
  });
});

describe('editability matrix', () => {
  it('open allows structural edits; locked freezes them', () => {
    expect(isGroupEditable('open', 'payouts')).toBe(true);
    expect(isGroupEditable('open', 'settings')).toBe(true);
    expect(isGroupEditable('locked', 'payouts')).toBe(false);
    expect(isGroupEditable('locked', 'settings')).toBe(false);
  });
  it('locked still allows cosmetic + contact + lifecycle', () => {
    for (const g of ['basics', 'contact', 'branding', 'reminders', 'lifecycle'] as const) {
      expect(isGroupEditable('locked', g)).toBe(true);
    }
  });
  it('classifies keys', () => {
    expect(classifyUpdateKey('name')).toBe('basics');
    expect(classifyUpdateKey('venmo')).toBe('paymentHandles');
    expect(classifyUpdateKey('isLocked')).toBe('lifecycle');
    expect(classifyUpdateKey('isPublic')).toBe('lifecycle');
    expect(classifyUpdateKey('isListedPublic')).toBe('lifecycle');
    expect(classifyUpdateKey('bogus')).toBeUndefined();
  });
});

describe('buildPoolSettingsUpdate', () => {
  it('accepts allowed edits on an open pool', () => {
    const plan = buildPoolSettingsUpdate({ status: 'OPEN' }, { name: 'New Name', settings: { entryFee: 5 } });
    expect(plan.set).toEqual({ name: 'New Name', settings: { entryFee: 5 } });
    expect(plan.clearLegacy).toEqual([]);
  });
  it('rejects a structural edit on a locked pool', () => {
    expect(() => buildPoolSettingsUpdate({ isLocked: true }, { payouts: { places: [], bonuses: [] } })).toThrow();
  });
  it('rejects unknown keys', () => {
    expect(() => buildPoolSettingsUpdate({ status: 'OPEN' }, { billing: { status: 'active' } })).toThrow();
  });
  /**
   * The claim `NFLManagerView`'s public-listing fix is built on.
   *
   * That toggle sent `settings.isListedPublic` and nothing else, while Browse
   * (`src/utils/publicListing.ts`) decides an NFL pool's listing from the
   * TOP-LEVEL `isPublic` — so the toggle wrote a field nothing reads. The fix
   * sends both halves, which is only safe if this callable accepts the
   * top-level key and writes it top-level. These pin that.
   */
  it('accepts a top-level isPublic and keeps it top-level', () => {
    const plan = buildPoolSettingsUpdate(
      { status: 'OPEN' },
      { isPublic: false, settings: { isListedPublic: false } },
    );
    expect(plan.set).toEqual({ isPublic: false, settings: { isListedPublic: false } });
  });

  it('still accepts isPublic on a LOCKED pool — visibility is lifecycle, not settings', () => {
    // The blast radius, stated as a test: listing can be turned off after the
    // pool locks. The settings blob cannot, which is why the manager form's
    // whole save is refused there — but the classification itself is this.
    expect(() => buildPoolSettingsUpdate({ isLocked: true }, { isPublic: false })).not.toThrow();
    expect(() => buildPoolSettingsUpdate({ isLocked: true }, { settings: { isListedPublic: false } })).toThrow();
  });

  it('dual-writes legacy handles and clears the absent ones', () => {
    const plan = buildPoolSettingsUpdate({ status: 'OPEN' }, { paymentHandles: { venmo: '@me', googlePay: 'g' } });
    expect(plan.set.paymentHandles).toEqual({ venmo: '@me', googlePay: 'g' });
    expect(plan.set.venmo).toBe('@me');
    expect(plan.clearLegacy.sort()).toEqual(['cashapp', 'paypal', 'zelle']);
  });
});

describe('the public-listing payload survives the whole pipeline', () => {
  it('lands isPublic at the top level and isListedPublic under settings', () => {
    const { set } = buildPoolSettingsUpdate(
      { status: 'OPEN' },
      { isPublic: false, settings: { isListedPublic: false, entryFee: 5 } },
    );
    const patch = flattenSettingsPatch(set, 'NFL_PICKEM');
    expect(patch).toEqual({
      isPublic: false,
      'settings.isListedPublic': false,
      'settings.entryFee': 5,
    });
    // The half the old code sent, on its own, never reaches the field Browse
    // reads — which is the entire defect, asserted rather than described.
    expect(Object.keys(flattenSettingsPatch(
      buildPoolSettingsUpdate({ status: 'OPEN' }, { settings: { isListedPublic: false } }).set,
      'NFL_PICKEM',
    ))).toEqual(['settings.isListedPublic']);
  });
});

describe('flattenSettingsPatch — merge-preserving settings writes (PR-B′)', () => {
  it('expands a whole-settings replacement into per-key dotted writes', () => {
    // THE BUG THIS EXISTS FOR: NFLManagerView sends a COMPLETE settings object,
    // and a Firestore `update({ settings: {...} })` REPLACES the map. A routine
    // save after a commissioner extended a deadline would silently delete
    // `weekLockOverrides` — reverting the accepted deadline — and reset
    // `lockRevision`, breaking the scoring concurrency protocol.
    expect(flattenSettingsPatch({ name: 'N', settings: { entryFee: 5, pickMode: 'ATS' } }, 'NFL_PICKEM'))
      .toEqual({ name: 'N', 'settings.entryFee': 5, 'settings.pickMode': 'ATS' });
  });

  it('leaves a payload with no settings key untouched', () => {
    expect(flattenSettingsPatch({ name: 'N' }, 'NFL_PICKEM')).toEqual({ name: 'N' });
  });

  it('REJECTS the server-owned nested keys', () => {
    for (const key of SERVER_OWNED_SETTINGS_KEYS) {
      expect(() => flattenSettingsPatch({ settings: { [key]: { 1: 123 } } }, 'NFL_PICKEM'))
        .toThrow(/managed by the server/);
    }
  });

  it('rejects a settings key that would escape its own field path', () => {
    // `settings.a.b` written as a dotted path lands somewhere else entirely.
    expect(() => flattenSettingsPatch({ settings: { 'a.b': 1 } }, 'NFL_PICKEM'))
      .toThrow(/not a valid settings key/);
    expect(() => flattenSettingsPatch({ settings: { '`x`': 1 } }, 'NFL_PICKEM'))
      .toThrow(/not a valid settings key/);
  });

  it('rejects a non-object settings value', () => {
    expect(() => flattenSettingsPatch({ settings: null }, 'NFL_PICKEM')).toThrow(/must be an object/);
    expect(() => flattenSettingsPatch({ settings: [1] }, 'NFL_PICKEM')).toThrow(/must be an object/);
  });

  it('forces WEEKLY lock and snaps the buffer to a preset for Survivor/Margin', () => {
    // codex r29: protecting the field is not enough once direct writes are
    // blocked — a manager can still call the callable with an arbitrary buffer
    // and move the "hard" deadline.
    for (const type of ['NFL_SURVIVOR', 'NFL_MARGIN']) {
      const out = flattenSettingsPatch({ settings: { lockMode: 'PER_GAME', lockBufferMinutes: 0 } }, type);
      expect(out['settings.lockMode']).toBe('WEEKLY');
      expect(out['settings.lockBufferMinutes']).toBe(5);
    }
    expect(flattenSettingsPatch({ settings: { lockBufferMinutes: 60 } }, 'NFL_SURVIVOR')['settings.lockBufferMinutes'])
      .toBe(60);
  });

  it('leaves Pick’em lock settings alone — it keeps per-game locks and extensions', () => {
    const out = flattenSettingsPatch({ settings: { lockMode: 'PER_GAME', lockBufferMinutes: 15 } }, 'NFL_PICKEM');
    expect(out['settings.lockMode']).toBe('PER_GAME');
    expect(out['settings.lockBufferMinutes']).toBe(15);
  });
});

describe("Pick'em lock buffer — bounded, not free-form (codex r3)", () => {
  it('REJECTS a negative buffer, which would move the lock AFTER kickoff', () => {
    // effectiveGameLockAt computes `kickoff - buffer`, so -60 puts the lock an
    // hour past kickoff and lets a pick change on a game whose result is already
    // published. publishedWeeks does not cover this — it only guards EXTENSIONS.
    expect(() => flattenSettingsPatch({ settings: { lockBufferMinutes: -60 } }, 'NFL_PICKEM'))
      .toThrow(/lockBufferMinutes/);
  });

  it('rejects a non-numeric or absurdly wide buffer', () => {
    expect(() => flattenSettingsPatch({ settings: { lockBufferMinutes: 'soon' } }, 'NFL_PICKEM'))
      .toThrow(/lockBufferMinutes/);
    expect(() => flattenSettingsPatch({ settings: { lockBufferMinutes: 10000 } }, 'NFL_PICKEM'))
      .toThrow(/lockBufferMinutes/);
  });

  it('accepts the ordinary range, including 0 (lock exactly at kickoff)', () => {
    expect(flattenSettingsPatch({ settings: { lockBufferMinutes: 0 } }, 'NFL_PICKEM'))
      .toEqual({ 'settings.lockBufferMinutes': 0 });
    expect(flattenSettingsPatch({ settings: { lockBufferMinutes: 1440 } }, 'NFL_PICKEM'))
      .toEqual({ 'settings.lockBufferMinutes': 1440 });
  });
});

describe('touchesLockSettings — which saves must serialize with the scoring lease', () => {
  it.each(LOCK_AFFECTING_SETTINGS_KEYS)('flags settings.%s', (key) => {
    expect(touchesLockSettings({ [`settings.${key}`]: 1 })).toBe(true);
  });

  it('includes confidenceMode, which silently converts a pool to weekly locking', () => {
    // Submission derives weekly-lock mode from
    // `settings.confidenceMode || settings.lockMode === 'WEEKLY'`.
    expect(LOCK_AFFECTING_SETTINGS_KEYS).toContain('confidenceMode');
  });

  it('does NOT flag an ordinary cosmetic save', () => {
    expect(touchesLockSettings({ name: 'N', 'settings.entryFee': 5 })).toBe(false);
  });

  it('treats an unflattened whole-settings write as lock-affecting', () => {
    // Defence against a future caller that skips flattenSettingsPatch: an
    // unexamined settings blob must not be waved through the lease check.
    expect(touchesLockSettings({ settings: { entryFee: 5 } })).toBe(true);
  });
});

describe('flattenSettingsPatch — survivor parity settings are validated, not forwarded', () => {
  // `updatePoolSettingsSchema.updates` is `z.record(z.string(), z.unknown())`, so
  // whatever a caller sends arrives here unvalidated. The failure this exists to
  // stop is specific: a NEGATIVE maxTeamUses reads as "unlimited" to any `> 0`
  // test, which is the opposite of the restriction the manager was tightening.
  it('passes the legitimate values through', () => {
    expect(flattenSettingsPatch({ settings: { tieCountsAs: 'WIN', maxTeamUses: 0 } }, 'NFL_SURVIVOR'))
      .toEqual({ 'settings.tieCountsAs': 'WIN', 'settings.maxTeamUses': 0 });
  });

  // '' is in this list on purpose: `Number('')` is 0, the unlimited sentinel, so
  // a coercing guard would turn an empty form field into "no restriction".
  it.each([-1, 1.5, '2', '', true, NaN, 24, null])('REJECTS maxTeamUses %p rather than coercing it', (value) => {
    expect(() => flattenSettingsPatch({ settings: { maxTeamUses: value } }, 'NFL_SURVIVOR'))
      .toThrow(/maxTeamUses/);
  });

  it.each(['win', 'TIE', '', 1, null])('REJECTS tieCountsAs %p', (value) => {
    expect(() => flattenSettingsPatch({ settings: { tieCountsAs: value } }, 'NFL_SURVIVOR'))
      .toThrow(/tieCountsAs/);
  });
});
