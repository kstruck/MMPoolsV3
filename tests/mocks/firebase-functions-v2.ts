import { vi } from 'vitest';

export const https = {
    onCall: vi.fn((handler: any) => handler),
    onRequest: vi.fn((handler: any) => handler),
};

export const scheduler = {
    onSchedule: vi.fn((schedule: string, handler: any) => handler),
};

export const firestore = {
    onDocumentCreated: vi.fn((path: string, handler: any) => handler),
    onDocumentUpdated: vi.fn((path: string, handler: any) => handler),
    onDocumentDeleted: vi.fn((path: string, handler: any) => handler),
};

export const onSchedule = vi.fn((schedule: string, handler: any) => handler);
export const onCall = vi.fn((handler: any) => handler);
export const onRequest = vi.fn((handler: any) => handler);
export const onDocumentWritten = vi.fn((path: string, handler: any) => handler);
export const onDocumentCreated = vi.fn((path: string, handler: any) => handler);
export const onDocumentUpdated = vi.fn((path: string, handler: any) => handler);
export const onDocumentDeleted = vi.fn((path: string, handler: any) => handler);

export default {
    https,
    scheduler,
    firestore,
    onSchedule,
    onCall,
    onRequest,
    onDocumentWritten,
    onDocumentCreated,
    onDocumentUpdated,
    onDocumentDeleted
};
