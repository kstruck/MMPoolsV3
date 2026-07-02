import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    mockGet, mockUpdate, mockRunTransaction, 
    mockTransactionGet, mockTransactionUpdate 
} from 'firebase-admin';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Mocks
// ─────────────────────────────────────────────────────────────────────────────


import { mockCreateSession } from 'stripe';

// Import functions under test
import { redeemCoupon, onPoolParticipantChange } from '../functions/src/billing';
import { createCheckoutSession } from '../functions/src/stripe';
import { createBracketEntry } from '../functions/src/bracketEntries';

describe('Onboarding Flow: Coupon & Checkout Billing Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Standard transaction callback mock
        mockRunTransaction.mockImplementation(async (callback) => {
            const t = {
                get: mockTransactionGet,
                update: mockTransactionUpdate,
                set: vi.fn(),
            };
            return callback(t);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // A. Coupon Code Verification / Redemption Tests
    // ─────────────────────────────────────────────────────────────────────────────
    describe('redeemCoupon callable function', () => {
        const standardAuth = { uid: 'user-123', token: { email: 'user@example.com' } };

        it('should throw unauthenticated HttpsError if user is not signed in', async () => {
            const req = {
                auth: null,
                data: { couponCode: 'SAVE20', poolId: 'pool-123' }
            } as any;

            await expect(redeemCoupon(req)).rejects.toThrowError(
                'You must be signed in to redeem a coupon.'
            );
        });

        it('should throw invalid-argument HttpsError if couponCode or poolId is missing', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: '', poolId: 'pool-123' }
            } as any;

            await expect(redeemCoupon(req)).rejects.toThrowError(
                'couponCode and poolId are required.'
            );
        });

        it('should throw not-found HttpsError if the target pool does not exist', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'SAVE20', poolId: 'pool-123' }
            } as any;

            // Pool doesn't exist
            mockGet.mockResolvedValueOnce({ exists: false });

            await expect(redeemCoupon(req)).rejects.toThrowError('Pool not found.');
        });

        it('should throw not-found HttpsError if the coupon code does not exist', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'FAKECODE', poolId: 'pool-123' }
            } as any;

            // Pool exists
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({ type: 'BRACKET' })
            });

            // Coupon query empty
            mockTransactionGet.mockResolvedValueOnce({
                empty: true,
                docs: []
            });

            await expect(redeemCoupon(req)).rejects.toThrowError('Coupon code not found.');
        });

        it('should throw failed-precondition if coupon is inactive', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'INACTIVE', poolId: 'pool-123' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({ type: 'BRACKET' })
            });

            mockTransactionGet.mockResolvedValueOnce({
                empty: false,
                docs: [{
                    id: 'coupon-doc',
                    ref: { id: 'coupon-doc' },
                    data: () => ({
                        code: 'INACTIVE',
                        isActive: false,
                        discountType: 'flat',
                        discountValue: 10
                    })
                }]
            });

            await expect(redeemCoupon(req)).rejects.toThrowError('This coupon is no longer active.');
        });

        it('should throw failed-precondition if coupon is expired', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'EXPIRED', poolId: 'pool-123' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({ type: 'BRACKET' })
            });

            mockTransactionGet.mockResolvedValueOnce({
                empty: false,
                docs: [{
                    id: 'coupon-doc',
                    ref: { id: 'coupon-doc' },
                    data: () => ({
                        code: 'EXPIRED',
                        isActive: true,
                        expiresAt: Date.now() - 10000, // expired 10s ago
                        discountType: 'percentage',
                        discountValue: 15
                    })
                }]
            });

            await expect(redeemCoupon(req)).rejects.toThrowError('This coupon has expired.');
        });

        it('should throw resource-exhausted if coupon has reached maxUses limit', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'MAXED', poolId: 'pool-123' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({ type: 'BRACKET' })
            });

            mockTransactionGet.mockResolvedValueOnce({
                empty: false,
                docs: [{
                    id: 'coupon-doc',
                    ref: { id: 'coupon-doc' },
                    data: () => ({
                        code: 'MAXED',
                        isActive: true,
                        usesCount: 5,
                        maxUses: 5,
                        discountType: 'percentage',
                        discountValue: 15
                    })
                }]
            });

            await expect(redeemCoupon(req)).rejects.toThrowError(
                'This coupon has reached its maximum number of uses.'
            );
        });

        it('should throw resource-exhausted if user has reached their perUserLimit', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'ONCE', poolId: 'pool-123' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({ type: 'BRACKET' })
            });

            mockTransactionGet.mockResolvedValueOnce({
                empty: false,
                docs: [{
                    id: 'coupon-doc',
                    ref: { id: 'coupon-doc' },
                    data: () => ({
                        code: 'ONCE',
                        isActive: true,
                        usesCount: 1,
                        perUserLimit: 1,
                        discountType: 'percentage',
                        discountValue: 15,
                        usageLog: [{ userId: 'user-123', poolId: 'pool-abc', usedAt: Date.now() - 1000 }]
                    })
                }]
            });

            await expect(redeemCoupon(req)).rejects.toThrowError(
                'You have already used this coupon the maximum number of times.'
            );
        });

        it('should throw failed-precondition if coupon is not allowed for the pool type', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'SQUARESONLY', poolId: 'pool-123' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                // Pool type is BRACKET
                data: () => ({ type: 'BRACKET' })
            });

            mockTransactionGet.mockResolvedValueOnce({
                empty: false,
                docs: [{
                    id: 'coupon-doc',
                    ref: { id: 'coupon-doc' },
                    data: () => ({
                        code: 'SQUARESONLY',
                        isActive: true,
                        discountType: 'flat',
                        discountValue: 5,
                        allowedPoolTypes: ['SQUARES'] // squares only!
                    })
                }]
            });

            await expect(redeemCoupon(req)).rejects.toThrowError(
                'This coupon is not valid for BRACKET pools.'
            );
        });

        it('should succeed and increment usesCount when coupon is valid and active', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: 'VALID10', poolId: 'pool-123' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({ type: 'BRACKET' })
            });

            const mockRef = { id: 'coupon-doc-ref' };
            mockTransactionGet.mockResolvedValueOnce({
                empty: false,
                docs: [{
                    id: 'coupon-doc',
                    ref: mockRef,
                    data: () => ({
                        code: 'VALID10',
                        isActive: true,
                        usesCount: 2,
                        maxUses: 10,
                        discountType: 'percentage',
                        discountValue: 10,
                        allowedPoolTypes: ['BRACKET']
                    })
                }]
            });

            const result = await redeemCoupon(req);

            expect(result).toEqual({
                valid: true,
                discountType: 'percentage',
                discountValue: 10
            });
            expect(mockTransactionUpdate).toHaveBeenCalledWith(mockRef, expect.objectContaining({
                usesCount: expect.any(Object), // admin.firestore.FieldValue.increment
                usageLog: expect.any(Object)  // admin.firestore.FieldValue.arrayUnion
            }));
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // B. Stripe Checkout Session and Dynamic Redirect Tests
    // ─────────────────────────────────────────────────────────────────────────────
    describe('createCheckoutSession callable function', () => {
        const standardAuth = { uid: 'user-123', token: { email: 'user@example.com' } };

        it('should throw unauthenticated if user is not signed in', async () => {
            const req = {
                auth: null,
                data: { poolId: 'pool-123', poolName: 'March Madness', poolType: 'BRACKET', tier: 'premium_tier', price: 29.00 }
            } as any;

            await expect(createCheckoutSession(req)).rejects.toThrowError(
                'You must be signed in to create a checkout session.'
            );
        });

        it('should throw invalid-argument if fields are missing', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: '', poolName: 'March Madness', poolType: 'BRACKET', tier: 'premium_tier', price: 29.00 }
            } as any;

            await expect(createCheckoutSession(req)).rejects.toThrowError(
                'poolId, poolName, tier, and price are required.'
            );
        });

        it('should throw invalid-argument if price is negative', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', poolName: 'March Madness', poolType: 'BRACKET', tier: 'premium_tier', price: -5.00 }
            } as any;

            await expect(createCheckoutSession(req)).rejects.toThrowError(
                'Price must be non-negative.'
            );
        });

        it('should throw not-found if the pool document is missing', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'missing-pool', poolName: 'March Madness', poolType: 'BRACKET', tier: 'premium_tier', price: 29.00 }
            } as any;

            // Authoritative price is resolved from billing_config first, then the pool is fetched.
            mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ pricing: { bracket: [{ min: 0, max: 10, price: 29 }] } }) });
            mockGet.mockResolvedValueOnce({ exists: false });

            await expect(createCheckoutSession(req)).rejects.toThrowError('Pool not found.');
        });

        it('should successfully create checkout session and return URL with resolved origin (referrer)', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', poolName: 'Best Bracket', poolType: 'BRACKET', tier: 'premium_tier', price: 49.00, couponCode: 'HELLO' },
                rawRequest: {
                    headers: {
                        referer: 'http://localhost:5173/wizard/summary'
                    }
                }
            } as any;

            // Mock pool exists
            mockGet.mockResolvedValueOnce({ exists: true });

            const result = await createCheckoutSession(req);

            expect(result).toEqual({ sessionUrl: 'https://checkout.stripe.com/pay/mock_session_123' });
            expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
                mode: 'payment',
                success_url: 'http://localhost:5173/pool/pool-123?payment=success&session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'http://localhost:5173/pool/pool-123?payment=cancelled',
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: 'Best Bracket — Premium Hosting',
                                description: 'One-time hosting fee for your BRACKET pool'
                            },
                            unit_amount: 4900 // 49.00 * 100
                        },
                        quantity: 1
                    }
                ],
                metadata: {
                    poolId: 'pool-123',
                    userId: 'user-123',
                    tier: 'premium_tier',
                    poolType: 'BRACKET',
                    couponCode: 'HELLO',
                    referralCredits: '0',
                    maxPlayersAllowed: '10'
                }
            }));
        });

        it('should fallback to default domain if referer/origin headers are missing', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', poolName: 'Survivor Pool', poolType: 'SEASON', tier: 'standard_tier', price: 19.99 },
                rawRequest: {
                    headers: {}
                }
            } as any;

            mockGet.mockResolvedValueOnce({ exists: true });

            await createCheckoutSession(req);

            expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
                success_url: 'https://marchmelee.com/pool/pool-123?payment=success&session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'https://marchmelee.com/pool/pool-123?payment=cancelled'
            }));
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // C. Free Plan 10-Player Participant Limit & Alerts Tests
    // ─────────────────────────────────────────────────────────────────────────────
    describe('Free Plan Participant limits & email notifications', () => {
        const standardAuth = { uid: 'user-123', token: { email: 'user@example.com' } };

        it('should allow createBracketEntry on Free Plan when entries < 10', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', name: 'My Bracket' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    status: 'OPEN',
                    settings: { maxEntriesPerUser: 1 },
                    billing: { status: 'free' },
                    entryCount: 5
                })
            });

            // Mock check user entries snapshot
            mockTransactionGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    status: 'OPEN',
                    settings: { maxEntriesPerUser: 1 },
                    billing: { status: 'free' },
                    entryCount: 5
                })
            }).mockResolvedValueOnce({
                size: 0 // No existing entries for this user
            });

            const result = await createBracketEntry(req);
            expect(result.success).toBe(true);
        });

        it('should block createBracketEntry on Free Plan when entries >= 10', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', name: 'My Bracket' }
            } as any;

            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    status: 'OPEN',
                    settings: { maxEntriesPerUser: 1 },
                    billing: { status: 'free' },
                    entryCount: 10 // already at 10 players!
                })
            });

            mockTransactionGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    status: 'OPEN',
                    settings: { maxEntriesPerUser: 1 },
                    billing: { status: 'free' },
                    entryCount: 10
                })
            });

            await expect(createBracketEntry(req)).rejects.toThrowError(
                'This pool is on the Free Plan and has reached the limit of 10 participants. The pool manager must upgrade to premium to allow more participants to join.'
            );
        });

        it('should trigger approaching limit (8/10) email notification onPoolParticipantChange', async () => {
            const mockAdd = vi.fn();
            const mockUpdateDoc = vi.fn();
            
            // Mock collection for pools and mail
            const { mockCollection } = await import('firebase-admin');
            mockCollection.mockImplementation((colName) => {
                if (colName === 'mail') {
                    return { add: mockAdd };
                }
                return {
                    doc: () => ({
                        update: mockUpdateDoc
                    })
                };
            });

            const event = {
                params: { poolId: 'pool-123' },
                data: {
                    after: {
                        data: () => ({
                            name: 'Approaching Pool',
                            type: 'BRACKET',
                            entryCount: 8, // 8 participants
                            billing: { status: 'free', notified8: false },
                            contactEmail: 'manager@example.com'
                        })
                    }
                }
            } as any;

            await onPoolParticipantChange(event);

            expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
                to: 'manager@example.com',
                message: expect.objectContaining({
                    subject: expect.stringContaining('approaching the Free Plan limit')
                })
            }));
            expect(mockUpdateDoc).toHaveBeenCalledWith(expect.objectContaining({
                'billing.notified8': true
            }));
        });

        it('should trigger limit reached (10/10) email notification onPoolParticipantChange', async () => {
            const mockAdd = vi.fn();
            const mockUpdateDoc = vi.fn();
            
            const { mockCollection } = await import('firebase-admin');
            mockCollection.mockImplementation((colName) => {
                if (colName === 'mail') {
                    return { add: mockAdd };
                }
                return {
                    doc: () => ({
                        update: mockUpdateDoc
                    })
                };
            });

            const event = {
                params: { poolId: 'pool-123' },
                data: {
                    after: {
                        data: () => ({
                            name: 'Full Pool',
                            type: 'BRACKET',
                            entryCount: 10, // 10 participants
                            billing: { status: 'free', notified10: false },
                            contactEmail: 'manager@example.com'
                        })
                    }
                }
            } as any;

            await onPoolParticipantChange(event);

            expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
                to: 'manager@example.com',
                message: expect.objectContaining({
                    subject: expect.stringContaining('has reached the Free Plan limit')
                })
            }));
            expect(mockUpdateDoc).toHaveBeenCalledWith(expect.objectContaining({
                'billing.notified10': true,
                'billing.notified8': true
            }));
        });
    });
});
