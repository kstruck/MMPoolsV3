import { vi } from 'vitest';

export const onCall = vi.fn((handler: any) => handler);

export class HttpsError extends Error {
    constructor(public code: string, message: string) {
        super(message);
        this.name = 'HttpsError';
    }
}
