import { vi } from 'vitest';

export const mockGet = vi.fn();
export const mockSet = vi.fn();
export const mockUpdate = vi.fn();
export const mockAdd = vi.fn();
export const mockRunTransaction = vi.fn();
export const mockTransactionGet = vi.fn();
export const mockTransactionUpdate = vi.fn();

export const mockLimit = vi.fn();
export const mockWhere = vi.fn(() => ({
    limit: mockLimit
}));

export const mockCollection = vi.fn((colName) => {
    if (colName === 'coupons') {
        return {
            where: mockWhere
        };
    }
    return {
        doc: (docId: string) => ({
            get: mockGet,
            update: mockUpdate,
            collection: vi.fn(() => ({
                where: vi.fn(() => ({
                    get: mockTransactionGet
                })),
                doc: vi.fn(() => ({
                    get: mockGet,
                    set: vi.fn()
                }))
            }))
        })
    };
});

export const mockDb = {
    collection: mockCollection,
    runTransaction: mockRunTransaction
};

export const FieldValue = {
    increment: vi.fn((val) => ({ type: 'increment', value: val })),
    arrayUnion: vi.fn((...elements) => ({ type: 'arrayUnion', elements })),
    serverTimestamp: vi.fn(() => 'mock-server-timestamp'),
};

export const firestore = vi.fn(() => mockDb) as any;
firestore.FieldValue = FieldValue;

export const initializeApp = vi.fn();

export const auth = vi.fn(() => ({
    getUser: vi.fn().mockResolvedValue({
        email: 'mock@example.com',
        displayName: 'Mock User'
    })
}));

export class Timestamp {
    static now = () => ({ toMillis: () => Date.now() });
    static fromMillis = (ms: number) => ({ toMillis: () => ms });
    constructor(public seconds: number, public nanoseconds: number) {}
    toMillis() { return this.seconds * 1000 + this.nanoseconds / 1000000; }
}

export default {
    firestore,
    initializeApp,
    auth,
    FieldValue,
    Timestamp
};
