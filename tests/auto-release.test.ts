import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin'; // Use real admin for types/static values
import { checkPaymentReminders, notifyWaitlist } from '../functions/src/reminders';
import { GameState, Square, WaitlistEntry } from '../functions/src/types';

// Mock dependencies
vi.mock('../functions/src/audit', () => ({
    writeAuditEvent: vi.fn(),
    computeDigitsHash: vi.fn().mockReturnValue('mock-hash')
}));

vi.mock('../functions/src/emailStyles', () => ({
    renderEmailHtml: vi.fn((title, body) => `<html>${title}: ${body}</html>`),
    escapeHtml: vi.fn((s: string) => s),
    BASE_URL: 'http://localhost'
}));

// Mock logger
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

// Create a mock DB object
const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockUpdate = vi.fn();
const mockAdd = vi.fn();
const mockGenericGet = vi.fn();
const mockRunTransaction = vi.fn();

const mockDb = {
    collection: mockCollection,
    doc: mockDoc,
    runTransaction: mockRunTransaction,
} as unknown as admin.firestore.Firestore;

describe('Auto-Release Logic', () => {
    // Helper to create a base pool
    const createPool = (overrides: Partial<GameState> = {}): GameState => ({
        id: 'pool-123',
        name: 'Test Pool',
        type: 'SQUARES',
        managerName: 'Admin',
        contactEmail: 'admin@example.com',
        squares: [],
        waitlist: [],
        reminders: {
            payment: { enabled: true, autoRelease: true, autoReleaseHours: 24, repeatEveryHours: 24, notifyUsers: true, graceMinutes: 0 },
            lock: { enabled: true, lockAt: Date.now() + 100000, scheduleMinutes: [60] }
        },
        ...overrides
    } as GameState);

    const createSquare = (id: number, owner: string | null = null, reservedAt: number | null = null, isPaid = false): Square => ({
        id: id,
        owner: owner,
        isPaid: isPaid,
        reservedAt: reservedAt,
        playerDetails: owner ? { email: `${owner}@example.com`, name: owner } : undefined
    } as Square);

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup Firestore Mock Chain
        mockCollection.mockReturnValue({
            doc: mockDoc,
            add: mockAdd,
            // squarePrivate subcollection reads (getSquareEmails/getSquarePrivateMap)
            // return an empty QuerySnapshot — these tests don't assert on PII emails.
            get: vi.fn().mockResolvedValue({ forEach: () => { }, docs: [], empty: true, size: 0 })
        });
        mockDoc.mockReturnValue({
            get: mockGet,
            set: mockSet,
            update: mockUpdate,
            collection: mockCollection // Recursive for subcollections
        });
        mockGenericGet.mockResolvedValue({
            exists: true,
            data: () => ({})
        });

        // Transaction Mock
        mockRunTransaction.mockImplementation(async (callback) => {
            const t = {
                get: mockGenericGet,
                update: mockUpdate,
                set: vi.fn(),
            };
            return callback(t);
        });
    });

    it('should release unpaid squares older than autoReleaseHours', async () => {
        const now = Date.now();
        const reservedAt = now - (25 * 60 * 60 * 1000); // 25 hours ago

        const square = createSquare(1, 'UserA', reservedAt, false); // Reserved 25h ago, Unpaid
        const pool = createPool({ squares: [square] });

        // Mock Transaction Get to return the pool
        mockGenericGet.mockResolvedValue({
            exists: true,
            data: () => pool
        });

        await checkPaymentReminders(mockDb, pool, now);

        // Verify Transaction Update was called containing 'squares' logic
        const updateCalls = mockUpdate.mock.calls;
        // console.log('Update Calls (Release):', JSON.stringify(updateCalls, null, 2));

        const checkCall = updateCalls.find(call => call[1].squares);
        expect(checkCall).toBeDefined();

        if (checkCall) {
            const updatedSquares = checkCall[1].squares as Square[];
            expect(updatedSquares[0].owner).toBeNull(); // Should be released
            expect(updatedSquares[0].reservedAt).toBeNull();
        }
    });

    it('should NOT release squares if auto-release is disabled', async () => {
        const now = Date.now();
        const reservedAt = now - (25 * 60 * 60 * 1000);
        const square = createSquare(1, 'UserA', reservedAt, false);
        const pool = createPool({
            squares: [square],
            reminders: {
                payment: { enabled: true, autoRelease: false, autoReleaseHours: 24, repeatEveryHours: 24, notifyUsers: true, graceMinutes: 0 },
                lock: { enabled: false, scheduleMinutes: [] },
                winner: { enabled: false, channels: [], includeDigits: false, includeCharityImpact: false }
            } // Disabled
        });

        await checkPaymentReminders(mockDb, pool, now);

        const updateCalls = mockUpdate.mock.calls;
        const checkCall = updateCalls.find(call => call[1].squares);
        expect(checkCall).toBeUndefined();
    });

    it('should NOT release paid squares', async () => {
        const now = Date.now();
        const reservedAt = now - (25 * 60 * 60 * 1000);
        const square = createSquare(1, 'UserA', reservedAt, true); // PAID
        const pool = createPool({ squares: [square] });

        await checkPaymentReminders(mockDb, pool, now);

        const updateCalls = mockUpdate.mock.calls;
        const checkCall = updateCalls.find(call => call[1].squares);
        expect(checkCall).toBeUndefined();
    });

    it('should NOT release squares within the time window', async () => {
        const now = Date.now();
        const reservedAt = now - (23 * 60 * 60 * 1000); // 23 hours ago (Less than 24)
        const square = createSquare(1, 'UserA', reservedAt, false);
        const pool = createPool({ squares: [square] });

        await checkPaymentReminders(mockDb, pool, now);

        const updateCalls = mockUpdate.mock.calls;
        const checkCall = updateCalls.find(call => call[1].squares);
        expect(checkCall).toBeUndefined();
    });

    it('should notify waitlist when squares are released', async () => {
        const now = Date.now();
        const reservedAt = now - (25 * 60 * 60 * 1000);
        const square = createSquare(1, 'UserA', reservedAt, false);
        const waitlistEntry: WaitlistEntry = { email: 'wait@example.com', name: 'Wait', timestamp: now };

        const pool = createPool({
            squares: [square],
            waitlist: [waitlistEntry]
        });

        mockGenericGet.mockResolvedValue({
            exists: true,
            data: () => pool
        });

        await notifyWaitlist(mockDb, pool, 1);

        // Expect add to be called for the email
        // Note: mockAdd is called on collection('mail')
        // We can inspect mockAdd calls.
        const addCalls = mockAdd.mock.calls;

        const waitlistEmail = addCalls.find(call => call[0].to === 'wait@example.com');
        expect(waitlistEmail).toBeDefined();
        if (waitlistEmail) {
            expect(waitlistEmail[0].message.subject).toContain('Squares Available');
        }
    });

    it('should notify the host when squares are released', async () => {
        const now = Date.now();
        const reservedAt = now - (25 * 60 * 60 * 1000);
        const square = createSquare(1, 'UserA', reservedAt, false);
        const pool = createPool({ squares: [square] });

        mockGenericGet.mockResolvedValue({
            exists: true,
            data: () => pool
        });

        await checkPaymentReminders(mockDb, pool, now);

        const addCalls = mockAdd.mock.calls;
        const hostEmail = addCalls.find(call => call[0].to === 'admin@example.com');
        expect(hostEmail).toBeDefined();
        if (hostEmail) {
            expect(hostEmail[0].message.subject).toContain('Squares Auto-Released');
        }
    });
});
