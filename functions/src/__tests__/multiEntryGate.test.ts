/**
 * PLAN-MULTI-ENTRY T1 / D8 — `settings.maxEntriesPerUser`.
 *
 *  - the three NFL create schemas ACCEPT it, default it to 1, and refuse 0 / 11
 *    (z.object strips unknown keys, so "accepts" is the load-bearing half);
 *  - the update gate is raise-only, judged by EFFECTIVE value (absent ⇒ 1);
 *  - a re-sent equal value is a no-op key, so an ordinary save pays no transaction;
 *  - flattenSettingsPatch refuses a malformed value instead of coercing it.
 */
import { describe, it, expect } from 'vitest';
import { pickemCreateInputSchema, survivorCreateInputSchema, marginCreateInputSchema } from '../shared/schemas/nfl';
import { effectiveMaxEntriesPerUser, MAX_ENTRIES_PER_USER_CAP } from '../shared/multiEntry';
import { maxEntriesNoOpKeys, maxEntriesRefusal, touchesMaxEntriesSetting, MAX_ENTRIES_SETTING_KEY } from '../lib/multiEntryGate';
import { flattenSettingsPatch } from '../lib/poolUpdate';

const base = { name: 'p', season: '2026', contactEmail: 'a@example.com', managerName: 'A' } as Record<string, unknown>;
const payouts = { places: [{ rank: 1, percentage: 100 }], bonuses: [] };
const settingsFor = (type: string, extra: Record<string, unknown> = {}) => ({
    entryFee: 10, payouts,
    ...(type === 'NFL_SURVIVOR' ? { maxStrikes: 1, maxRebuys: 0 } : {}),
    ...extra,
});
const schemas = [
    ['NFL_PICKEM', pickemCreateInputSchema],
    ['NFL_SURVIVOR', survivorCreateInputSchema],
    ['NFL_MARGIN', marginCreateInputSchema],
] as const;

describe('create schemas carry maxEntriesPerUser (D8 — z.object strips what is not declared)', () => {
    it.each(schemas)('%s: default 1 when absent, keeps 3, refuses 0 and 11', (type, schema) => {
        const absent = schema.parse({ ...base, type, settings: settingsFor(type) });
        expect(absent.settings.maxEntriesPerUser).toBe(1);
        const three = schema.parse({ ...base, type, settings: settingsFor(type, { maxEntriesPerUser: 3 }) });
        expect(three.settings.maxEntriesPerUser).toBe(3);
        expect(schema.safeParse({ ...base, type, settings: settingsFor(type, { maxEntriesPerUser: 0 }) }).success).toBe(false);
        expect(schema.safeParse({ ...base, type, settings: settingsFor(type, { maxEntriesPerUser: MAX_ENTRIES_PER_USER_CAP + 1 }) }).success).toBe(false);
        expect(schema.safeParse({ ...base, type, settings: settingsFor(type, { maxEntriesPerUser: 2.5 }) }).success).toBe(false);
    });
});

describe('effectiveMaxEntriesPerUser', () => {
    it('absent, malformed or sub-1 ⇒ 1; caps at the wizard bound', () => {
        expect(effectiveMaxEntriesPerUser(undefined)).toBe(1);
        expect(effectiveMaxEntriesPerUser({})).toBe(1);
        expect(effectiveMaxEntriesPerUser({ maxEntriesPerUser: '3' })).toBe(1);
        expect(effectiveMaxEntriesPerUser({ maxEntriesPerUser: 0 })).toBe(1);
        expect(effectiveMaxEntriesPerUser({ maxEntriesPerUser: 4 })).toBe(4);
        expect(effectiveMaxEntriesPerUser({ maxEntriesPerUser: 99 })).toBe(MAX_ENTRIES_PER_USER_CAP);
    });
});

describe('maxEntriesRefusal — raise-only, by effective value (K6)', () => {
    const legacy = { settings: { entryFee: 10 } };           // field absent ⇒ 1
    const three = { settings: { entryFee: 10, maxEntriesPerUser: 3 } };
    const p = (n: unknown) => ({ [MAX_ENTRIES_SETTING_KEY]: n });

    it('touches only when the dotted key is present', () => {
        expect(touchesMaxEntriesSetting(p(2))).toBe(true);
        expect(touchesMaxEntriesSetting({ 'settings.entryFee': 5 })).toBe(false);
    });
    it('legacy pool: 1 → 3 allowed; 3 → 2 refused; 3 → 3 allowed (equal is not a lowering)', () => {
        expect(maxEntriesRefusal(legacy, p(3))).toBeNull();
        expect(maxEntriesRefusal(three, p(2))).toMatch(/RAISE_ONLY/);
        expect(maxEntriesRefusal(three, p(3))).toBeNull();
        expect(maxEntriesRefusal(three, p(10))).toBeNull();
    });
    it('malformed values are refused, never coerced', () => {
        expect(maxEntriesRefusal(legacy, p('3'))).toMatch(/INVALID/);
        expect(maxEntriesRefusal(legacy, p(0))).toMatch(/INVALID/);
        expect(maxEntriesRefusal(legacy, p(11))).toMatch(/INVALID/);
        expect(maxEntriesRefusal(legacy, p(2.5))).toMatch(/INVALID/);
    });
    it('untouched patch: no refusal', () => {
        expect(maxEntriesRefusal(three, { 'settings.entryFee': 5 })).toBeNull();
    });
});

describe('maxEntriesNoOpKeys — a re-sent equal value is not a change', () => {
    it('legacy pool re-saving 1 is a no-op; 2 is not; a pool at 3 re-saving 3 is a no-op', () => {
        expect(maxEntriesNoOpKeys({ settings: {} }, { [MAX_ENTRIES_SETTING_KEY]: 1 })).toEqual([MAX_ENTRIES_SETTING_KEY]);
        expect(maxEntriesNoOpKeys({ settings: {} }, { [MAX_ENTRIES_SETTING_KEY]: 2 })).toEqual([]);
        expect(maxEntriesNoOpKeys({ settings: { maxEntriesPerUser: 3 } }, { [MAX_ENTRIES_SETTING_KEY]: 3 })).toEqual([MAX_ENTRIES_SETTING_KEY]);
        expect(maxEntriesNoOpKeys({ settings: { maxEntriesPerUser: 3 } }, { 'settings.entryFee': 5 })).toEqual([]);
    });
});

describe('flattenSettingsPatch — shape validation on the way in', () => {
    it('passes 1..10 through as the dotted key and refuses everything else', () => {
        expect(flattenSettingsPatch({ settings: { maxEntriesPerUser: 4 } }, 'NFL_MARGIN')).toEqual({ [MAX_ENTRIES_SETTING_KEY]: 4 });
        for (const bad of [0, 11, '3', 2.5, null]) {
            expect(() => flattenSettingsPatch({ settings: { maxEntriesPerUser: bad } }, 'NFL_MARGIN')).toThrow(/maxEntriesPerUser/);
        }
    });
});
