import { describe, it, expect } from 'vitest';
import { diffTopLevel } from '../lib/configDiff';

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
