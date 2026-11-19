import { describe, it, expect } from 'vitest';
import { squaresHostingIsFree } from './squaresFreeOffer';

const cfg = (squares: unknown) => ({ pricing: { squares } });

describe('squaresHostingIsFree — the live price behind the homepage promo (qodo on #792)', () => {
    it('yes: the K10 config, one $0 band', () => {
        expect(squaresHostingIsFree(cfg([{ min: 11, max: 9999, price: 0 }]))).toBe(true);
    });

    it('yes: several bands, all $0', () => {
        expect(squaresHostingIsFree(cfg([{ min: 11, max: 50, price: 0 }, { min: 51, max: 9999, price: 0 }]))).toBe(true);
    });

    it('no: any band with a price — the claim must go the moment a price is set', () => {
        expect(squaresHostingIsFree(cfg([{ min: 11, max: 50, price: 0 }, { min: 51, max: 9999, price: 10 }]))).toBe(false);
        expect(squaresHostingIsFree(cfg([{ min: 11, max: 9999, price: 0.01 }]))).toBe(false);
    });

    it('no: nothing to confirm the price with', () => {
        expect(squaresHostingIsFree(undefined)).toBe(false);
        expect(squaresHostingIsFree(null)).toBe(false);
        expect(squaresHostingIsFree({})).toBe(false);
        expect(squaresHostingIsFree(cfg(undefined))).toBe(false);
        expect(squaresHostingIsFree(cfg([]))).toBe(false);
    });

    it('no: malformed tiers fail the server schema, so they confirm nothing', () => {
        expect(squaresHostingIsFree(cfg([{ min: 11, max: 9999, price: '0' }]))).toBe(false);
        expect(squaresHostingIsFree(cfg([{ min: 11, max: 9999, price: -1 }]))).toBe(false);
        // Not contiguous: the second band must start at 51.
        expect(squaresHostingIsFree(cfg([{ min: 11, max: 50, price: 0 }, { min: 60, max: 9999, price: 0 }]))).toBe(false);
    });
});
