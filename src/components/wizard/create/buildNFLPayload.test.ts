import { describe, it, expect } from 'vitest';
import { buildNFLPayload } from './buildNFLPayload';
import { pickemCreateInputSchema, survivorCreateInputSchema, marginCreateInputSchema } from '@shared/schemas';

const pickemBase: Record<string, unknown> = {
  type: 'NFL_PICKEM', name: 'Weekly Pickem', season: '2025', isPublic: true,
  managerName: '', contactEmail: '',
  paymentHandles: { venmo: '@x', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  paymentInstructions: '',
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  settings: {
    entryFee: 10, isListedPublic: true, lockMode: 'PER_GAME', payoutMode: 'SEASON',
    pickMode: 'STRAIGHT', lockBufferMinutes: 5, confidenceMode: false,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
};

describe('buildNFLPayload', () => {
  // PLAN-MULTI-ENTRY D8 / T1. The toggle is a wizard-only key; the builder folds
  // it into settings.maxEntriesPerUser and the schema keeps (does not strip) it.
  it('multi-entry: toggle off ⇒ 1 even if a value was typed; on ⇒ at least 2 and the value survives the schema; above the cap is REFUSED, not clamped', () => {
    const off = buildNFLPayload({ ...pickemBase, multiEntry: false, settings: { ...(pickemBase.settings as object), maxEntriesPerUser: 5 } }, 'NFL_PICKEM');
    expect((off.settings as { maxEntriesPerUser?: number }).maxEntriesPerUser).toBe(1);
    const on = buildNFLPayload({ ...pickemBase, multiEntry: true, settings: { ...(pickemBase.settings as object), maxEntriesPerUser: 4 } }, 'NFL_PICKEM');
    const parsed = pickemCreateInputSchema.safeParse(on);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.settings.maxEntriesPerUser).toBe(4);
    // Toggle ON ⇒ at least 2, whatever the field holds (untouched NaN, or the form default 1).
    const untouched = buildNFLPayload({ ...pickemBase, multiEntry: true, settings: { ...(pickemBase.settings as object), maxEntriesPerUser: NaN } }, 'NFL_PICKEM');
    expect((untouched.settings as { maxEntriesPerUser?: number }).maxEntriesPerUser).toBe(2);
    const stillOne = buildNFLPayload({ ...pickemBase, multiEntry: true, settings: { ...(pickemBase.settings as object), maxEntriesPerUser: 1 } }, 'NFL_PICKEM');
    expect((stillOne.settings as { maxEntriesPerUser?: number }).maxEntriesPerUser).toBe(2);
    const tooMany = buildNFLPayload({ ...pickemBase, multiEntry: true, settings: { ...(pickemBase.settings as object), maxEntriesPerUser: 11 } }, 'NFL_PICKEM');
    expect(pickemCreateInputSchema.safeParse(tooMany).success).toBe(false);
    // Absent entirely (a payload from before this setting) still defaults to 1 at the schema.
    const legacy = pickemCreateInputSchema.safeParse(buildNFLPayload(pickemBase, 'NFL_PICKEM'));
    if (legacy.success) expect(legacy.data.settings.maxEntriesPerUser).toBe(1);
  });

  /**
   * PLAN-PAYMENT-LEDGER T2 / D1. `weeklyPayouts` is HYBRID-only, and the wizard
   * keeps the values of unmounted fields — so the builder, not the commissioner,
   * is what stops a stray weekly list reaching a SEASON pool's create call.
   */
  it('weeklyPayouts: carried on HYBRID, dropped on every other mode, dropped when empty (T2 / D1)', () => {
    const weekly = { places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }] };
    const hybrid = buildNFLPayload({
      ...pickemBase,
      settings: { ...(pickemBase.settings as object), payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 6, seasonPerEntry: 4 }, weeklyPayouts: weekly },
    }, 'NFL_PICKEM');
    expect((hybrid.settings as { weeklyPayouts?: unknown }).weeklyPayouts).toEqual(weekly);
    const parsed = pickemCreateInputSchema.safeParse(hybrid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.settings.weeklyPayouts).toEqual(weekly);

    // Tried HYBRID, typed places, settled on SEASON/WEEKLY: the list is gone,
    // and the payload still passes the gate that would have refused it.
    for (const payoutMode of ['SEASON', 'WEEKLY'] as const) {
      const stray = buildNFLPayload({ ...pickemBase, settings: { ...(pickemBase.settings as object), payoutMode, weeklyPayouts: weekly } }, 'NFL_PICKEM');
      expect((stray.settings as { weeklyPayouts?: unknown }).weeklyPayouts, payoutMode).toBeUndefined();
      expect(pickemCreateInputSchema.safeParse(stray).success, payoutMode).toBe(true);
    }

    // An untouched editor is ABSENT, never `{ places: [] }` — absent means
    // "payouts prices both pots", empty would mean "no weekly prizes at all".
    const empty = buildNFLPayload({
      ...pickemBase,
      settings: { ...(pickemBase.settings as object), payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 6, seasonPerEntry: 4 }, weeklyPayouts: { places: [] } },
    }, 'NFL_PICKEM');
    expect((empty.settings as { weeklyPayouts?: unknown }).weeklyPayouts).toBeUndefined();
  });

  it('builds a pickem payload that passes the server schema gate', () => {
    const p = buildNFLPayload(pickemBase, 'NFL_PICKEM');
    expect(p.type).toBe('NFL_PICKEM');
    expect(p.league).toBe('NFL');
    expect(p.season).toBe('2025');
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(true);
  });

  // The wizard exposes a Straight/ATS choice (Kevin, 2026-08-06). Before that it
  // hardcoded STRAIGHT, so nothing ever proved the OTHER value survives the
  // payload builder and the server schema — a silently-dropped `pickMode` would
  // have quietly downgraded every ATS pool to straight-up scoring, and the
  // commissioner would only find out when a push scored as a win.
  it.each(['STRAIGHT', 'ATS'] as const)('carries pickMode=%s through to the payload', mode => {
    const src = { ...pickemBase, settings: { ...(pickemBase.settings as object), pickMode: mode } };
    const p = buildNFLPayload(src, 'NFL_PICKEM') as Record<string, any>;
    expect(p.settings.pickMode).toBe(mode);
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('rejects a pickMode the scorer does not implement', () => {
    // The select can only emit the two valid values, but the payload is
    // hand-buildable and the schema is the real gate. If this ever passes, the
    // enum has been widened without the scorer being taught the new mode.
    const src = { ...pickemBase, settings: { ...(pickemBase.settings as object), pickMode: 'TEASER' } };
    const p = buildNFLPayload(src, 'NFL_PICKEM');
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(false);
  });

  it('dual-writes legacy handles', () => {
    const p = buildNFLPayload(pickemBase, 'NFL_PICKEM') as Record<string, any>;
    expect(p.venmo).toBe('@x');
    expect(p.paymentHandles.venmo).toBe('@x');
    expect('zelle' in p).toBe(false);
  });

  it('passes through survivor-specific settings and gate', () => {
    const survivorBase: Record<string, unknown> = {
      ...pickemBase, type: 'NFL_SURVIVOR',
      settings: {
        entryFee: 20, isListedPublic: true,
        maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 4, rebuyCost: 20,
        pickLosersMode: false, autoSurviveExemptionEnabled: true,
        payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
      },
    };
    const p = buildNFLPayload(survivorBase, 'NFL_SURVIVOR');
    expect((p.settings as any).maxStrikes).toBe(1);
    expect(survivorCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('carries the parity settings THROUGH the schema — it strips unknown keys', () => {
    // `survivorCreateInputSchema.settings` is a z.object, so a field the schema
    // does not name is silently DROPPED at create and the wizard's control would
    // do nothing at all. Assert on the PARSED output, not on safeParse success:
    // a stripped key still parses fine (sweep S3).
    const survivorBase: Record<string, unknown> = {
      ...pickemBase, type: 'NFL_SURVIVOR',
      settings: {
        entryFee: 20, isListedPublic: true,
        maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 4, rebuyCost: 20,
        pickLosersMode: false, autoSurviveExemptionEnabled: true,
        tieCountsAs: 'WIN', maxTeamUses: 2,
        payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
      },
    };
    const parsed = survivorCreateInputSchema.parse(buildNFLPayload(survivorBase, 'NFL_SURVIVOR'));
    expect(parsed.settings.tieCountsAs).toBe('WIN');
    expect(parsed.settings.maxTeamUses).toBe(2);
  });

  it('rejects an out-of-contract parity value at create', () => {
    const bad = (settings: Record<string, unknown>) => survivorCreateInputSchema.safeParse(
      buildNFLPayload({
        ...pickemBase, type: 'NFL_SURVIVOR',
        settings: {
          entryFee: 0, isListedPublic: true,
          maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 4, rebuyCost: 0,
          payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
          ...settings,
        },
      }, 'NFL_SURVIVOR'),
    ).success;
    expect(bad({ maxTeamUses: -1 })).toBe(false); // must not read as "unlimited"
    expect(bad({ maxTeamUses: 1.5 })).toBe(false);
    expect(bad({ tieCountsAs: 'win' })).toBe(false);
  });

  it('passes through margin settings and gate', () => {
    const marginBase: Record<string, unknown> = {
      ...pickemBase, type: 'NFL_MARGIN',
      settings: {
        entryFee: 15, isListedPublic: true, payoutMode: 'SEASON',
        payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
      },
    };
    const p = buildNFLPayload(marginBase, 'NFL_MARGIN');
    expect(p.type).toBe('NFL_MARGIN');
    expect(marginCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('carries top-level launch fields (estimatedPlayers + addons) the server reads for free/trial', () => {
    const p = buildNFLPayload(
      {
        ...pickemBase,
        estimatedPlayers: 50,
        addons: { aiCommissioner: false, smsNotifications: false, whatIfSimulator: true, customBranding: false },
      },
      'NFL_PICKEM',
    ) as Record<string, any>;
    expect(p.estimatedPlayers).toBe(50);
    expect(p.addons.whatIfSimulator).toBe(true);
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('omits estimatedPlayers when blank/0 and defaults all addons to false', () => {
    const p = buildNFLPayload(pickemBase, 'NFL_PICKEM') as Record<string, any>;
    expect('estimatedPlayers' in p).toBe(false);
    expect(p.addons).toEqual({ aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false });
  });

  it('carries seasonType as a number (select fields deliver strings) and passes the gate', () => {
    const p = buildNFLPayload({ ...pickemBase, seasonType: '1' }, 'NFL_PICKEM') as Record<string, any>;
    expect(p.seasonType).toBe(1);
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('omits seasonType when unset (server defaults to regular season)', () => {
    const p = buildNFLPayload(pickemBase, 'NFL_PICKEM') as Record<string, any>;
    expect('seasonType' in p).toBe(false);
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('rejects an out-of-range seasonType at the schema gate', () => {
    const p = buildNFLPayload({ ...pickemBase, seasonType: '7' }, 'NFL_PICKEM');
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(false);
  });
});
