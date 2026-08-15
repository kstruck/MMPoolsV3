import { describe, it, expect } from 'vitest';
import { poolTypeLabel, poolOptionLabels } from './poolTypeLabel';

describe('poolTypeLabel / poolOptionLabels — a My Entries card can tell pools apart', () => {
    it('names every pool type, and falls back honestly', () => {
        expect(poolTypeLabel({ type: 'NFL_PICKEM' })).toBe("Pick'em");
        expect(poolTypeLabel({ type: 'NFL_SURVIVOR' })).toBe('Survivor');
        expect(poolTypeLabel({ type: 'NFL_MARGIN' })).toBe('Margin');
        expect(poolTypeLabel({ type: 'SQUARES' })).toBe('Squares');
        expect(poolTypeLabel({ type: 'BRACKET' })).toBe('Bracket');
        expect(poolTypeLabel({ type: 'NFL_PLAYOFFS' })).toBe('Playoff');
        expect(poolTypeLabel({ type: 'PROPS' })).toBe('Props');
        // Unknown is said to be unknown, never dressed as a generic "Pool".
        expect(poolTypeLabel({ type: 'SOMETHING_NEW' })).toBe('Unknown type');
        expect(poolTypeLabel(null)).toBe('Unknown type');
    });

    it("Pick'em: straight-up vs ATS, confidence, payout mode — in a fixed order", () => {
        expect(poolOptionLabels({ type: 'NFL_PICKEM', settings: { pickMode: 'ATS', confidenceMode: true, payoutMode: 'HYBRID' } }))
            .toEqual(['Against the spread', 'Confidence', 'Hybrid (weekly + season)']);
        expect(poolOptionLabels({ type: 'NFL_PICKEM', settings: { pickMode: 'STRAIGHT', payoutMode: 'WEEKLY' } }))
            .toEqual(['Straight-up', 'Weekly prizes']);
        // No pickMode at all reads as straight-up — the schema default.
        expect(poolOptionLabels({ type: 'NFL_PICKEM', settings: {} })).toEqual(['Straight-up']);
    });

    it('Survivor: strikes and rebuys', () => {
        expect(poolOptionLabels({ type: 'NFL_SURVIVOR', settings: { maxStrikes: 0, maxRebuys: 0 } })).toEqual(['Sudden death']);
        expect(poolOptionLabels({ type: 'NFL_SURVIVOR', settings: { maxStrikes: 1, maxRebuys: 2 } })).toEqual(['1 strike', 'Rebuys']);
        expect(poolOptionLabels({ type: 'NFL_SURVIVOR', settings: { maxStrikes: 2 } })).toEqual(['2 strikes']);
    });

    it('Margin: payout mode only; other types have no settings-driven options', () => {
        expect(poolOptionLabels({ type: 'NFL_MARGIN', settings: { payoutMode: 'SEASON' } })).toEqual(['Season-long']);
        expect(poolOptionLabels({ type: 'SQUARES', settings: {} })).toEqual([]);
        expect(poolOptionLabels({ type: 'BRACKET' })).toEqual([]);
        expect(poolOptionLabels(undefined)).toEqual([]);
    });
});
