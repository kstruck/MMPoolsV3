import { describe, it, expect } from 'vitest';
import { stripEmptyCallableFields } from './callableParams';

describe('stripEmptyCallableFields', () => {
    it('drops undefined keys — the shape the callable serializer turns into null', () => {
        expect(stripEmptyCallableFields({ poolType: 'NFL_PICKEM', couponCode: undefined }))
            .toEqual({ poolType: 'NFL_PICKEM' });
        expect('couponCode' in stripEmptyCallableFields({ couponCode: undefined })).toBe(false);
    });

    it('drops null keys too', () => {
        expect(stripEmptyCallableFields({ a: 1, b: null })).toEqual({ a: 1 });
    });

    it('KEEPS falsy-but-meaningful values', () => {
        // `estimatedPlayers: 0` and `usedCredit: false` are real payload values.
        // A plain truthiness filter would delete them and change what the server
        // prices — a worse bug than the one being fixed.
        expect(stripEmptyCallableFields({ estimatedPlayers: 0, usedCredit: false, note: '' }))
            .toEqual({ estimatedPlayers: 0, usedCredit: false, note: '' });
    });

    it('keeps nested objects intact rather than recursing', () => {
        // `addons` is an object of booleans; the server schema requires the whole
        // object, and its `false` members must survive.
        const addons = { aiCommissioner: false, whatIfSimulator: true };
        expect(stripEmptyCallableFields({ addons })).toEqual({ addons });
    });

    it('leaves a payload with no empty fields unchanged', () => {
        const p = { poolId: 'p1', estimatedPlayers: 25 };
        expect(stripEmptyCallableFields(p)).toEqual(p);
    });
});
