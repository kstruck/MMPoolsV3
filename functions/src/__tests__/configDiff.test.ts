import { describe, it, expect } from 'vitest';
import { ABSENT, diffTopLevel, narrowChange, redactConfigValue } from '../lib/configDiff';

describe('diffTopLevel', () => {
    it('identical docs produce an EMPTY diff — the trigger must write nothing', () => {
        const doc = { maintenanceMode: false, poolTypeFlags: { NFL_PICKEM: true } };
        expect(diffTopLevel(doc, { ...doc, poolTypeFlags: { NFL_PICKEM: true } })).toEqual({});
    });

    it('captures a flag flip with from and to', () => {
        const out = diffTopLevel(
            { poolTypeFlags: { NFL_PICKEM: false } },
            { poolTypeFlags: { NFL_PICKEM: true } },
        );
        expect(out).toEqual({
            poolTypeFlags: { from: { NFL_PICKEM: false }, to: { NFL_PICKEM: true } },
        });
    });

    it('captures key ADDITION as from:ABSENT', () => {
        expect(diffTopLevel({}, { nflImport: { enabled: false } })).toEqual({
            nflImport: { from: ABSENT, to: { enabled: false } },
        });
    });

    it('captures key REMOVAL as to:ABSENT', () => {
        expect(diffTopLevel({ statsRecompute: { enabled: true } }, {})).toEqual({
            statsRecompute: { from: { enabled: true }, to: ABSENT },
        });
    });

    it('adding or deleting an EXPLICIT-null key still audits — null is a value, absent is not (codex r3)', () => {
        expect(diffTopLevel({}, { maintenanceMode: null })).toEqual({
            maintenanceMode: { from: ABSENT, to: null },
        });
        expect(diffTopLevel({ maintenanceMode: null }, {})).toEqual({
            maintenanceMode: { from: null, to: ABSENT },
        });
    });

    it('untouched sibling keys stay out of the diff', () => {
        const out = diffTopLevel(
            { maintenanceMode: false, autoClose: { enabled: true, dryRun: false } },
            { maintenanceMode: true, autoClose: { enabled: true, dryRun: false } },
        );
        expect(Object.keys(out)).toEqual(['maintenanceMode']);
    });
});

describe('redactConfigValue', () => {
    it('booleans, numbers and null pass through — the kill-switch record survives', () => {
        expect(redactConfigValue(true)).toBe(true);
        expect(redactConfigValue(45)).toBe(45);
        expect(redactConfigValue(null)).toBe(null);
    });

    it('strings are masked — ops-alert recipients never reach the audit doc', () => {
        expect(redactConfigValue('kevin@example.com')).toBe('[string]');
    });

    it('objects recurse per key; string array elements are masked individually', () => {
        expect(redactConfigValue({ enabled: true, notifyEmail: 'a@b.c', sms: ['+1555'] }))
            .toEqual({ enabled: true, notifyEmail: '[string]', sms: ['[string]'] });
    });
});

describe('narrowChange', () => {
    it('object change narrows to the flags that moved — a 7-flag map fits the 200-char cap', () => {
        const all = {
            SQUARES: false, BRACKET: false, NFL_PLAYOFFS: false, PROPS: false,
            NFL_PICKEM: false, NFL_SURVIVOR: false, NFL_MARGIN: false,
        };
        const out = narrowChange({ from: all, to: { ...all, NFL_PICKEM: true } });
        expect(out).toEqual({ from: { NFL_PICKEM: false }, to: { NFL_PICKEM: true } });
        expect(JSON.stringify(out).length).toBeLessThan(200);
    });

    it('non-object changes pass through untouched', () => {
        expect(narrowChange({ from: null, to: true })).toEqual({ from: null, to: true });
        expect(narrowChange({ from: 60, to: 90 })).toEqual({ from: 60, to: 90 });
    });
});

describe('qodo #362 hardening', () => {
    it('the ABSENT sentinel survives redaction — adds/removes stay distinguishable', () => {
        expect(redactConfigValue(ABSENT)).toBe(ABSENT);
    });

    it('primitive arrays survive redaction — a same-length edit stays visible', () => {
        expect(redactConfigValue([1])).toEqual([1]);
        expect(redactConfigValue([2])).toEqual([2]);
        expect(redactConfigValue(['a@b.c', 1])).toEqual(['[string]', 1]);
    });

    it('long arrays truncate with a marker, not silently', () => {
        const out = redactConfigValue(Array.from({ length: 25 }, (_, i) => i)) as unknown[];
        expect(out).toHaveLength(21);
        expect(out[20]).toBe('[+5 more]');
    });

    it('NaN vs null is a CHANGE — JSON aliases both to "null" and would silence the audit (codex r5)', () => {
        const out = diffTopLevel({ scoreTickerSpeed: NaN }, { scoreTickerSpeed: null });
        expect(Object.keys(out)).toEqual(['scoreTickerSpeed']);
        expect(diffTopLevel({ x: Infinity }, { x: Infinity })).toEqual({});
    });

    it('__proto__ as a config key diffs like any other key', () => {
        const out = diffTopLevel({}, JSON.parse('{"__proto__": {"enabled": true}}'));
        expect(Object.keys(out)).toEqual(['__proto__']);
        expect(({} as Record<string, unknown>).enabled).toBeUndefined();
    });
});
