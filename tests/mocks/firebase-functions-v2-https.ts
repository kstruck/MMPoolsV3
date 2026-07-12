import { vi } from 'vitest';

// Support both onCall(handler) and onCall(options, handler) — the validated()
// wrapper (functions/src/lib/validated.ts) always uses the two-arg form.
export const onCall = vi.fn((optionsOrHandler: any, maybeHandler?: any) =>
    typeof maybeHandler === 'function' ? maybeHandler : optionsOrHandler);

export class HttpsError extends Error {
    constructor(public code: string, message: string) {
        super(message);
        this.name = 'HttpsError';
    }
}
