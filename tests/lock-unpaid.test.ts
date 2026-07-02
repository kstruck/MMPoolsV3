import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

// Mock firebase-admin completely.
// These must be created via vi.hoisted() because vi.mock() factories are hoisted
// above normal const declarations — referencing plain consts would hit the TDZ.
const { mockGet, mockSet, mockUpdate, mockRunTransaction, mockDb, mockAuth } = vi.hoisted(() => {
    const mockGet = vi.fn();
    const mockSet = vi.fn();
    const mockUpdate = vi.fn();
    const mockRunTransaction = vi.fn();

    const mockCollection = vi.fn(() => ({
        doc: vi.fn(() => ({
            collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                    get: mockGet
                }))
            })),
            get: mockGet
        }))
    }));

    const mockDb = {
        collection: mockCollection,
        runTransaction: mockRunTransaction
    };

    const mockAuth = {
        getUser: vi.fn().mockResolvedValue({
            email: 'player@example.com',
            displayName: 'Test Player'
        })
    };

    return { mockGet, mockSet, mockUpdate, mockRunTransaction, mockDb, mockAuth };
});

vi.mock('firebase-admin', () => {
    class MockTimestamp {
        static now() { return { toMillis: () => Date.now() }; }
        static fromMillis(ms: number) { return { toMillis: () => ms }; }
        toMillis() { return Date.now(); }
    }
    return {
        default: {
            firestore: () => mockDb,
            auth: () => mockAuth,
            Timestamp: MockTimestamp
        },
        firestore: () => mockDb,
        auth: () => mockAuth,
        Timestamp: MockTimestamp
    };
});

// Mock helpers so we don't send real emails or crash on auth log
vi.mock('../functions/src/reminders', () => ({
    sendEmail: vi.fn().mockResolvedValue(true)
}));

vi.mock('../functions/src/emailStyles', () => ({
    renderEmailHtml: vi.fn(() => '<html></html>'),
    BASE_URL: 'http://localhost'
}));

// Import the internal business logic function
import { submitBracketEntryInternal } from '../functions/src/bracketEntries';

describe('Bracket Entry Submit Lock Unpaid Guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Transaction Mock
        mockRunTransaction.mockImplementation(async (callback) => {
            const t = {
                get: mockGet,
                update: mockUpdate,
                set: mockSet,
            };
            return callback(t);
        });
    });

    const createMockPicks = () => {
        const picks: Record<string, string> = {};
        for (let i = 1; i <= 63; i++) {
            picks[`game_${i}`] = 'TEAM_A';
        }
        return picks;
    };

    it('should successfully submit when lockUnpaid is false and entry is UNPAID', async () => {
        const mockEntryData = {
            id: 'entry-123',
            poolId: 'pool-123',
            ownerUid: 'user-123',
            name: 'Test Bracket',
            picks: createMockPicks(),
            status: 'DRAFT',
            paidStatus: 'UNPAID',
        };

        const mockPoolData = {
            id: 'pool-123',
            name: 'Test Pool',
            status: 'OPEN',
            lockAt: Date.now() + 1000000,
            settings: {
                lockUnpaid: false,
                maxEntriesPerUser: 3,
                maxEntriesTotal: 100
            }
        };

        // First mockGet returns entry, second mockGet returns pool
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => mockEntryData
        }).mockResolvedValueOnce({
            exists: true,
            data: () => mockPoolData
        }).mockResolvedValueOnce({
            exists: false // tournament lookup — no per-game lock in these tests
        }).mockResolvedValueOnce({
            exists: true,
            data: () => mockPoolData // post-commit re-read for the confirmation email
        });

        const data = {
            poolId: 'pool-123',
            entryId: 'entry-123',
            picks: createMockPicks(),
            tieBreakerPrediction: 150
        };

        const result = await submitBracketEntryInternal('user-123', data, mockDb);
        expect(result.success).toBe(true);
        expect(mockUpdate).toHaveBeenCalled();
    });

    it('should throw failed-precondition HttpsError when lockUnpaid is true and entry is UNPAID', async () => {
        const mockEntryData = {
            id: 'entry-123',
            poolId: 'pool-123',
            ownerUid: 'user-123',
            name: 'Test Bracket',
            picks: createMockPicks(),
            status: 'DRAFT',
            paidStatus: 'UNPAID', // Unpaid and locked!
        };

        const mockPoolData = {
            id: 'pool-123',
            name: 'Test Pool',
            status: 'OPEN',
            lockAt: Date.now() + 1000000,
            settings: {
                lockUnpaid: true, // Activated lock unpaid!
                maxEntriesPerUser: 3,
                maxEntriesTotal: 100
            }
        };

        // Throws after the pool read (before the tournament/email reads), so only
        // two gets are queued — extra onces would leak into the next test.
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => mockEntryData
        }).mockResolvedValueOnce({
            exists: true,
            data: () => mockPoolData
        });

        const data = {
            poolId: 'pool-123',
            entryId: 'entry-123',
            picks: createMockPicks(),
            tieBreakerPrediction: 150
        };

        await expect(submitBracketEntryInternal('user-123', data, mockDb)).rejects.toThrowError(
            'Your entry is currently unpaid. Please complete payment to submit picks.'
        );
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should successfully submit when lockUnpaid is true and entry is PAID', async () => {
        const mockEntryData = {
            id: 'entry-123',
            poolId: 'pool-123',
            ownerUid: 'user-123',
            name: 'Test Bracket',
            picks: createMockPicks(),
            status: 'DRAFT',
            paidStatus: 'PAID', // Marked paid by host
        };

        const mockPoolData = {
            id: 'pool-123',
            name: 'Test Pool',
            status: 'OPEN',
            lockAt: Date.now() + 1000000,
            settings: {
                lockUnpaid: true, // Activated lock unpaid!
                maxEntriesPerUser: 3,
                maxEntriesTotal: 100
            }
        };

        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => mockEntryData
        }).mockResolvedValueOnce({
            exists: true,
            data: () => mockPoolData
        }).mockResolvedValueOnce({
            exists: false // tournament lookup — no per-game lock in these tests
        }).mockResolvedValueOnce({
            exists: true,
            data: () => mockPoolData // post-commit re-read for the confirmation email
        });

        const data = {
            poolId: 'pool-123',
            entryId: 'entry-123',
            picks: createMockPicks(),
            tieBreakerPrediction: 150
        };

        const result = await submitBracketEntryInternal('user-123', data, mockDb);
        expect(result.success).toBe(true);
        expect(mockUpdate).toHaveBeenCalled();
    });
});
