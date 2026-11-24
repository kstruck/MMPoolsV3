import { describe, it, expect } from 'vitest';
import { squaresHostingIsFree } from './squaresFreeOffer';
import { DEFAULT_FORMAT_TIER_MAP } from '@shared/schemas/billingConfig';

const FREE = [{ min: 11, max: 9999, price: 0 }];
const PAID = [{ min: 11, max: 50, price: 20 }, { min: 51, max: 9999, price: 40 }];

/** A whole, schema-valid billing_config, as the server parses it. */
const cfg = (over: { squares?: unknown; season?: unknown; formatTierMap?: unknown; drop?: string } = {}) => {
    const doc: Record<string, unknown> = {
        freePlayerThreshold: 10,
        gracePeriodDays: 7,
        pricing: {
            season: 'season' in over ? over.season : PAID,
            bracket: PAID,
            squares: 'squares' in over ? over.squares : FREE,
            props: PAID,
        },
        formatTierMap: over.formatTierMap ?? DEFAULT_FORMAT_TIER_MAP,
        features: {
            aiCommissioner: { isPremium: true, addonPrice: 5 },
            whatIfSimulator: { isPremium: true, addonPrice: 5 },
            customBranding: { isPremium: true, addonPrice: 5 },
        },
    };
    if (over.drop) delete doc[over.drop];
    return doc;
};

describe('squaresHostingIsFree — the live price behind the homepage promo (qodo on #792)', () => {
    it('yes: the K10 config, one $0 squares band', () => {
        expect(squaresHostingIsFree(cfg())).toBe(true);
    });

    it('yes: several bands, all $0', () => {
        expect(squaresHostingIsFree(cfg({ squares: [{ min: 11, max: 50, price: 0 }, { min: 51, max: 9999, price: 0 }] }))).toBe(true);
    });

    it('no: any band with a price — the claim must go the moment a price is set', () => {
        expect(squaresHostingIsFree(cfg({ squares: [{ min: 11, max: 50, price: 0 }, { min: 51, max: 9999, price: 10 }] }))).toBe(false);
        expect(squaresHostingIsFree(cfg({ squares: [{ min: 11, max: 9999, price: 0.01 }] }))).toBe(false);
    });

    it('follows formatTierMap.SQUARES, as the server does (qodo round 2)', () => {
        // squares mapped to the PAID season tier, pricing.squares still $0: not free.
        expect(squaresHostingIsFree(cfg({ formatTierMap: { ...DEFAULT_FORMAT_TIER_MAP, SQUARES: 'season' } }))).toBe(false);
        // squares mapped to a $0 season tier, pricing.squares paid: free.
        expect(squaresHostingIsFree(cfg({ squares: PAID, season: FREE, formatTierMap: { ...DEFAULT_FORMAT_TIER_MAP, SQUARES: 'season' } }))).toBe(true);
    });

    it('no: nothing to confirm the price with', () => {
        expect(squaresHostingIsFree(undefined)).toBe(false);
        expect(squaresHostingIsFree(null)).toBe(false);
        expect(squaresHostingIsFree({})).toBe(false);
        expect(squaresHostingIsFree(cfg({ squares: [] }))).toBe(false);
    });

    it('no: a document the server would reject anywhere confirms nothing', () => {
        expect(squaresHostingIsFree(cfg({ squares: [{ min: 11, max: 9999, price: '0' }] }))).toBe(false);
        expect(squaresHostingIsFree(cfg({ squares: [{ min: 11, max: 9999, price: -1 }] }))).toBe(false);
        // Not contiguous: the second band must start at 51.
        expect(squaresHostingIsFree(cfg({ squares: [{ min: 11, max: 50, price: 0 }, { min: 60, max: 9999, price: 0 }] }))).toBe(false);
        // Squares tiers fine, but a required field elsewhere is missing.
        expect(squaresHostingIsFree(cfg({ drop: 'features' }))).toBe(false);
    });
});
