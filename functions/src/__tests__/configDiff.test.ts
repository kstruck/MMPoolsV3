import { describe, it, expect } from 'vitest';
import { diffTopLevel, narrowChange, redactConfigValue } from '../lib/configDiff';

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

    it('captures key ADDITION as from:null', () => {
        expect(diffTopLevel({}, { nflImport: { enabled: false } })).toEqual({
            nflImport: { from: null, to: { enabled: false } },
        });
    });

    it('captures key REMOVAL as to:null', () => {
        expect(diffTopLevel({ statsRecompute: { enabled: true } }, {})).toEqual({
            statsRecompute: { from: { enabled: true }, to: null },
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

    it('objects recurse per key, arrays report length only', () => {
        expect(redactConfigValue({ enabled: true, notifyEmail: 'a@b.c', sms: ['+1555'] }))
            .toEqual({ enabled: true, notifyEmail: '[string]', sms: '[array:1]' });
    });
});

describe('narrowChange', () => {
    it('object change narrows to the flags that moved — a 7-flag map fits the 200-char cap', () => {
        const all = { SQUARES: false, BRACKET: false, NFL_PLAYOFFS: false, PROPS: false, NFL_PICKEM: false, NFL_SURVIVOR: false, NFL_MARGIN: false };
        const out = narrowChange({ from: all, to: { ...all, NFL_PICKEM: true } });
        expect(out).toEqual({ from: { NFL_PICKEM: false }, to: { NFL_PICKEM: true } });
        expect(JSON.stringify(out).length).toBeLessThan(200);
    });

    it('non-object changes pass through untouched', () => {
        expect(narrowChange({ from: null, to: true })).toEqual({ from: null, to: true });
        expect(narrowChange({ from: 60, to: 90 })).toEqual({ from: 60, to: 90 });
    });
});
