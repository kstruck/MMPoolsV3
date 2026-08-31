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
        // clearAllMocks() does NOT drain the mockResolvedValueOnce queue, so a
        // test that consumes a different number of get() calls than it queued
        // would leak leftover return values into the next test. Reset the
        // queue-based mocks so each test's mock setup is self-contained.
        mockGet.mockReset();
        mockTransactionGet.mockReset();
        mockTransactionUpdate.mockReset();

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
                'Must be logged in.'
            );
        });

        it('should throw invalid-argument HttpsError if couponCode or poolId is missing', async () => {
            const req = {
                auth: standardAuth,
                data: { couponCode: '', poolId: 'pool-123' }
            } as any;

            await expect(redeemCoupon(req)).rejects.toThrowError(
                /Invalid request: couponCode/
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
                data: () => ({ type: 'BRACKET', ownerId: 'user-123' })
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
                data: () => ({ type: 'BRACKET', ownerId: 'user-123' })
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
                data: () => ({ type: 'BRACKET', ownerId: 'user-123' })
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
                data: () => ({ type: 'BRACKET', ownerId: 'user-123' })
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
                data: () => ({ type: 'BRACKET', ownerId: 'user-123' })
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
                data: () => ({ type: 'BRACKET', ownerId: 'user-123' })
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
                data: () => ({ type: 'BRACKET', ownerId: 'user-123' })
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
                'Must be logged in.'
            );
        });

        // Buy-flow overhaul (PLAN Phase 2): the checkout contract is hardened —
        // the client no longer sends price/tier/successUrl/cancelUrl; the server
        // prices from billing_config + validated add-ons and derives redirect
        // URLs from an allowlisted origin. poolType is a validated enum.
        it('should throw invalid-argument if required fields are missing (schema-validated)', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: '', poolName: 'March Madness', poolType: 'BRACKET', estimatedPlayers: 20 }
            } as any;

            // Empty poolId fails the checkout input schema.
            await expect(createCheckoutSession(req)).rejects.toThrowError(/Invalid request: poolId/);
        });

        it('should throw invalid-argument for an unknown pool format', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', poolName: 'March Madness', poolType: 'NOT_A_FORMAT', estimatedPlayers: 20 }
            } as any;

            await expect(createCheckoutSession(req)).rejects.toThrowError(/Invalid request/);
        });

        it('should throw not-found if the pool document is missing', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'missing-pool', poolName: 'March Madness', poolType: 'BRACKET', estimatedPlayers: 20 }
            } as any;

            // Pool is fetched FIRST now (before pricing). Missing pool → not-found.
            mockGet.mockResolvedValueOnce({ exists: false });

            await expect(createCheckoutSession(req)).rejects.toThrowError('Pool not found.');
        });

        it('should create a checkout session with a server-derived success URL (allowlisted origin)', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', poolName: 'Best Bracket', poolType: 'BRACKET', estimatedPlayers: 20, couponCode: 'HELLO' },
                rawRequest: {
                    headers: {
                        // localhost:5173 IS in the allowlist → used as the redirect origin.
                        origin: 'http://localhost:5173'
                    }
                }
            } as any;

            mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ type: 'BRACKET', ownerId: 'user-123' }) }); // pool
            mockGet.mockResolvedValueOnce({ exists: true, data: () => ({
                freePlayerThreshold: 10,
                gracePeriodDays: 7,
                pricing: { season: [], bracket: [{ min: 11, max: 25, price: 49 }], squares: [], props: [] },
                features: { aiCommissioner: { isPremium: true, addonPrice: 19 }, whatIfSimulator: { isPremium: true, addonPrice: 9 }, customBranding: { isPremium: true, addonPrice: 29 } },
            }) }); // billing_config
            mockGet.mockResolvedValueOnce({ empty: true }); // resolveCouponForQuote: coupon 'HELLO' not found

            // Transaction reads: fresh pool (no pending, not active), then coupon (empty).
            // K17: the in-transaction re-read is ownership-checked too, so the fixture carries the owner.
            mockTransactionGet.mockResolvedValueOnce({ exists: true, data: () => ({ ownerId: 'user-123', billing: {} }) }); // pool in txn
            mockTransactionGet.mockResolvedValueOnce({ empty: true, docs: [] }); // coupon in txn

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
                                name: 'Best Bracket — Standard Hosting',
                                description: 'One-time hosting fee for your BRACKET pool'
                            },
                            unit_amount: 4900 // server-priced: bracket tier for 20 players = $49
                        },
                        quantity: 1
                    }
                ],
                // reservationId is a random UUID → assert the stable metadata subset.
                metadata: expect.objectContaining({
                    poolId: 'pool-123',
                    userId: 'user-123',
                    poolType: 'BRACKET',
                    tier: 'standard_tier',
                    maxPlayersAllowed: '20'
                })
            }));
        });

        it('should fall back to the production origin when no allowlisted header is present', async () => {
            const req = {
                auth: standardAuth,
                data: { poolId: 'pool-123', poolName: 'Pickem Pool', poolType: 'NFL_PICKEM', estimatedPlayers: 30 },
                rawRequest: { headers: {} }
            } as any;

            mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ type: 'NFL_PICKEM', ownerId: 'user-123' }) }); // pool
            mockGet.mockResolvedValueOnce({ exists: true, data: () => ({
                freePlayerThreshold: 10,
                gracePeriodDays: 7,
                pricing: { season: [{ min: 11, max: 50, price: 59 }], bracket: [], squares: [], props: [] },
                features: { aiCommissioner: { isPremium: true, addonPrice: 19 }, whatIfSimulator: { isPremium: true, addonPrice: 9 }, customBranding: { isPremium: true, addonPrice: 29 } },
            }) }); // billing_config

            mockTransactionGet.mockResolvedValueOnce({ exists: true, data: () => ({ ownerId: 'user-123', billing: {} }) }); // pool in txn (no coupon this time) — K17 owner

            await createCheckoutSession(req);

            expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
                success_url: 'https://www.marchmeleepools.com/pool/pool-123?payment=success&session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'https://www.marchmeleepools.com/pool/pool-123?payment=cancelled'
            }));
        });

        it('refuses a signed-in user who is not the pool owner/manager (K17 ownership gate) — before any quote or Stripe call', async () => {
            const req = {
                auth: { uid: 'stranger-9', token: { email: 's@example.com' } },
                data: { poolId: 'pool-123', poolName: 'Best Bracket', poolType: 'BRACKET', estimatedPlayers: 20 },
                rawRequest: { headers: {} }
            } as any;
            mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ type: 'BRACKET', ownerId: 'user-123' }) }); // pool
            await expect(createCheckoutSession(req)).rejects.toMatchObject({ code: 'permission-denied' });
            expect(mockCreateSession).not.toHaveBeenCalled();
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
                // One message for every pool type since 2026-08-30 (shared/freePlanCap.ts).
                'This pool is full, so your spot could not be reserved.'
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
