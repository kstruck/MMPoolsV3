import { describe, it, expect, vi } from 'vitest';
import { sendEmail } from '../reminders';
import { settlementMailKey } from '../lib/settlement';

/**
 * qodo #4 on #715: a retry after a crash between the enqueue and the caller's
 * progress stamp must not send the email twice. `idempotencyKey` makes the mail
 * doc CREATE-once. The db is a stub; the opt-out lookups fail open by design
 * ("Unsubscribe infra unavailable — sending without opt-out check").
 */
function stubDb(createImpl: (data: unknown) => Promise<unknown>, existing?: Record<string, unknown>) {
    const create = vi.fn(createImpl);
    const add = vi.fn(async () => ({ id: 'auto' }));
    const set = vi.fn<(data: unknown) => Promise<undefined>>(async () => undefined);
    const get = vi.fn(async () => ({ data: () => existing }));
    const doc = vi.fn(() => ({ create, get, set }));
    return { db: { collection: vi.fn(() => ({ doc, add })) } as never, create, add, doc, set, get };
}
const ALREADY_EXISTS = () => { throw Object.assign(new Error('exists'), { code: 6 }); };

describe('sendEmail idempotencyKey', () => {
    it('creates the mail doc under the key and does not store the key', async () => {
        const { db, create, add, doc } = stubDb(async () => undefined);
        const out = await sendEmail(db, 'a@b.com', 'S', '<p>x</p>', { poolId: 'p1', reason: 'pool_settled', idempotencyKey: 'pool-settled-p1-1-u1' });
        expect(out).toBe('queued');
        expect(doc).toHaveBeenCalledWith('pool-settled-p1-1-u1');
        expect(add).not.toHaveBeenCalled();
        const stored = create.mock.calls[0][0] as Record<string, unknown>;
        expect(stored).toMatchObject({ to: 'a@b.com', poolId: 'p1', reason: 'pool_settled' });
        expect(stored).not.toHaveProperty('idempotencyKey');
    });

    it('a second send with the same key sends nothing and reports skipped', async () => {
        const { db } = stubDb(async () => { throw Object.assign(new Error('exists'), { code: 6 }); });
        expect(await sendEmail(db, 'a@b.com', 'S', '<p>x</p>', { idempotencyKey: 'k' })).toBe('skipped');
        const grpcName = stubDb(async () => { throw Object.assign(new Error('exists'), { code: 'already-exists' }); });
        expect(await sendEmail(grpcName.db, 'a@b.com', 'S', '<p>x</p>', { idempotencyKey: 'k' })).toBe('skipped');
    });

    it('an existing mail doc the extension marked ERROR is re-queued, not treated as delivered (qodo #2 on #720)', async () => {
        const { db, set } = stubDb(async () => ALREADY_EXISTS(), { delivery: { state: 'ERROR' } });
        const out = await sendEmail(db, 'a@b.com', 'S', '<p>x</p>', { poolId: 'p1', idempotencyKey: 'k' });
        expect(out).toBe('queued');
        // Overwritten with the fresh doc, which carries no `delivery` field.
        expect(set).toHaveBeenCalledTimes(1);
        expect(set.mock.calls[0][0]).toMatchObject({ to: 'a@b.com', poolId: 'p1' });
        expect(set.mock.calls[0][0]).not.toHaveProperty('delivery');
    });

    it('an existing mail doc that is pending, processing or delivered is left alone', async () => {
        for (const existing of [undefined, { delivery: { state: 'PENDING' } }, { delivery: { state: 'PROCESSING' } }, { delivery: { state: 'SUCCESS' } }]) {
            const { db, set } = stubDb(async () => ALREADY_EXISTS(), existing);
            expect(await sendEmail(db, 'a@b.com', 'S', '<p>x</p>', { idempotencyKey: 'k' })).toBe('skipped');
            expect(set).not.toHaveBeenCalled();
        }
    });

    it('settlementMailKey: distinct (pool, settlement, member) triples never collide, even with hyphens in the ids (qodo #3 on #720)', () => {
        // A plain "-" join gave the SAME id for both of these.
        expect(settlementMailKey('a-1', 2, 'b')).not.toBe(settlementMailKey('a', 1, '2-b'));
        expect(settlementMailKey('p', 7, 'u')).toBe('pool-settled~p~7~u');
        // Safe as a Firestore document id: no slash.
        expect(settlementMailKey('p/q', 7, 'u/v')).not.toContain('/');
    });

    it('any other create error is a failed enqueue, so the caller retries it', async () => {
        const { db } = stubDb(async () => { throw Object.assign(new Error('unavailable'), { code: 14 }); });
        expect(await sendEmail(db, 'a@b.com', 'S', '<p>x</p>', { idempotencyKey: 'k' })).toBe('failed');
    });

    it('a key with a slash cannot escape the collection', async () => {
        const { db, doc } = stubDb(async () => undefined);
        await sendEmail(db, 'a@b.com', 'S', '<p>x</p>', { idempotencyKey: 'a/b' });
        expect(doc).toHaveBeenCalledWith('a_b');
    });

    it('without a key it still uses add(), unchanged', async () => {
        const { db, create, add } = stubDb(async () => undefined);
        expect(await sendEmail(db, 'a@b.com', 'S', '<p>x</p>', { poolId: 'p1' })).toBe('queued');
        expect(add).toHaveBeenCalledTimes(1);
        expect(create).not.toHaveBeenCalled();
    });
});
