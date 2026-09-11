import { describe, it, expect } from 'vitest';
import { checkNFLNonPickerReminders } from '../reminders';
import { newDeliveryTally } from '../lib/deliveryTally';

/**
 * End-to-end guard for checkNFLNonPickerReminders against an in-memory
 * Firestore double: seeds a pool with a ROSTER-ONLY member (Member Record, no
 * entry — exactly the person 2026 Week 1 silently skipped), a member with a
 * complete sheet, and a hosting-only commissioner, then runs the pass inside
 * the T-24h window and asserts what got written.
 *
 * It asserts on the notifications dedupe docs and the `mail` queue, because
 * those are the two side effects a real send leaves behind; a rewrite that
 * finds the right uids but never reaches sendEmail would fail here and pass
 * nflNonPickers.test.ts.
 */

type Data = Record<string, any>;
type Filter = [string, string, unknown];

/** Minimal path-keyed Firestore stand-in: enough surface for the reminder pass. */
function makeDb() {
    const store = new Map<string, Data>();
    let autoId = 0;
    const nextId = () => `auto${++autoId}`;

    const matches = (data: Data, [f, op, v]: Filter) => {
        const actual = data[f];
        if (op === '==') return actual === v;
        if (op === '>') return actual > (v as number);
        if (op === 'in') return (v as unknown[]).includes(actual);
        throw new Error(`fake db: unsupported op ${op}`);
    };

    const docRef = (path: string): any => ({
        id: path.split('/').pop(),
        path,
        get: async () => ({ id: path.split('/').pop(), exists: store.has(path), data: () => store.get(path) }),
        set: async (data: Data, opts?: { merge?: boolean; mergeFields?: unknown }) => {
            store.set(path, opts?.merge || opts?.mergeFields ? { ...(store.get(path) ?? {}), ...data } : { ...data });
        },
        update: async (data: Data) => {
            if (!store.has(path)) throw new Error(`fake db: update of missing doc ${path}`);
            store.set(path, { ...store.get(path)!, ...data });
        },
        collection: (name: string) => colRef(`${path}/${name}`, []),
    });

    const colRef = (path: string, filters: Filter[]): any => ({
        where: (f: string, op: string, v: unknown) => colRef(path, [...filters, [f, op, v]]),
        limit: () => colRef(path, filters),
        doc: (id?: string) => docRef(`${path}/${id ?? nextId()}`),
        add: async (data: Data) => { const ref = docRef(`${path}/${nextId()}`); await ref.set(data); return ref; },
        get: async () => {
            const depth = path.split('/').length + 1;
            const docs = [...store.entries()]
                .filter(([p]) => p.startsWith(`${path}/`) && p.split('/').length === depth)
                .filter(([, d]) => filters.every(fl => matches(d, fl)))
                .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d, exists: true }));
            return { docs, empty: docs.length === 0, size: docs.length };
        },
    });

    const db: any = {
        collection: (name: string) => colRef(name, []),
        doc: (path: string) => docRef(path),
        runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
            get: (ref: any) => ref.get(),
            set: (ref: any, data: Data, opts?: any) => { void ref.set(data, opts); },
            update: (ref: any, data: Data) => { void ref.update(data); },
        }),
    };
    return { db, store, seed: (path: string, data: Data) => store.set(path, data) };
}

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const POOL_ID = 'pool1';
const WEEK = 1;
// First kickoff 20h05m out with a 5-minute buffer → lock in exactly 20h: inside the 24H window.
const KICKOFF = NOW + 20 * HOUR + 5 * 60 * 1000;

function seedPool(type: 'NFL_PICKEM' | 'NFL_SURVIVOR', settings: Data = {}) {
    const f = makeDb();
    const pool = { id: POOL_ID, type, name: 'Donkeys Test', season: '2026', seasonType: 2, status: 'OPEN', settings };
    f.seed(`pools/${POOL_ID}`, pool);
    f.seed('nfl_games/g1', { id: 'g1', season: '2026', seasonType: 2, week: WEEK, startTime: KICKOFF });
    f.seed('nfl_games/g2', { id: 'g2', season: '2026', seasonType: 2, week: WEEK, startTime: KICKOFF + 3 * 24 * HOUR });
    f.seed('nfl_games/g3', { id: 'g3', season: '2026', seasonType: 2, week: WEEK + 1, startTime: KICKOFF + 7 * 24 * HOUR });
    const joinedAt = NOW - 5 * 24 * HOUR;
    const member = (uid: string, role = 'PARTICIPANT') =>
        f.seed(`pools/${POOL_ID}/members/${uid}`, { uid, poolId: POOL_ID, userName: uid, role, joinedAt, paidStatus: 'UNPAID' });
    member('host', 'MANAGER');
    member('joined-never-picked');
    member('complete');
    member('partial');
    f.seed(`pools/${POOL_ID}/entries/complete`, { id: 'complete', ownerUid: 'complete', picks: { g1: 'SEA', g2: 'KC' }, userName: 'complete' });
    f.seed(`pools/${POOL_ID}/entries/partial`, { id: 'partial', ownerUid: 'partial', picks: { g1: 'SEA' }, userName: 'partial' });
    for (const uid of ['host', 'joined-never-picked', 'complete', 'partial']) f.seed(`users/${uid}`, { email: `${uid}@example.com` });
    return { ...f, pool: pool as any };
}

const notificationKeys = (store: Map<string, Data>) => [...store.keys()].filter(k => k.startsWith('notifications/')).sort();
const mailTo = (store: Map<string, Data>) => [...store.entries()].filter(([k]) => k.startsWith('mail/')).map(([, d]) => d.to).sort();

describe('checkNFLNonPickerReminders — roster-based, T-24h', () => {
    it('reminds the member who joined but never submitted, and the partial sheet; not the complete sheet or the host', async () => {
        const { db, store, pool } = seedPool('NFL_PICKEM');
        const tally = newDeliveryTally();
        await checkNFLNonPickerReminders(db, pool, NOW, undefined, tally);

        expect(notificationKeys(store)).toEqual([
            `notifications/NFL_NONPICK_24H:${POOL_ID}:joined-never-picked:${WEEK}`,
            `notifications/NFL_NONPICK_24H:${POOL_ID}:partial:${WEEK}`,
        ]);
        expect(mailTo(store)).toEqual(['joined-never-picked@example.com', 'partial@example.com']);
        expect(tally.queued).toBe(2);
        expect(tally.poolErrors).toBe(0);

        const mail = [...store.entries()].find(([k]) => k.startsWith('mail/'))![1];
        expect(mail.message.subject).toMatch(/Week 1 locks in ~20 hours/);
        expect(mail.category).toBe('reminders');
        expect(mail.poolId).toBe(POOL_ID);
    });

    it('is idempotent across polls: a second pass in the same window sends nothing new', async () => {
        const { db, store, pool } = seedPool('NFL_PICKEM');
        await checkNFLNonPickerReminders(db, pool, NOW);
        const after1 = mailTo(store);
        await checkNFLNonPickerReminders(db, pool, NOW + 15 * 60 * 1000);
        expect(mailTo(store)).toEqual(after1);
    });

    it('sends nothing outside the windows — 30h out (the retired T-36h band) and after the lock', async () => {
        for (const now of [KICKOFF - 5 * 60 * 1000 - 30 * HOUR, KICKOFF + HOUR]) {
            const { db, store, pool } = seedPool('NFL_PICKEM');
            await checkNFLNonPickerReminders(db, pool, now);
            expect(notificationKeys(store)).toEqual([]);
            expect(mailTo(store)).toEqual([]);
        }
    });

    it('4H tier: last call to whoever is still outstanding, deduped separately from 24H', async () => {
        const { db, store, pool } = seedPool('NFL_PICKEM');
        await checkNFLNonPickerReminders(db, pool, NOW);
        // 'partial' finishes their sheet between the two tiers.
        store.set(`pools/${POOL_ID}/entries/partial`, { id: 'partial', ownerUid: 'partial', picks: { g1: 'SEA', g2: 'KC' } });
        await checkNFLNonPickerReminders(db, pool, KICKOFF - 5 * 60 * 1000 - 2 * HOUR);
        expect(notificationKeys(store)).toEqual([
            `notifications/NFL_NONPICK_24H:${POOL_ID}:joined-never-picked:${WEEK}`,
            `notifications/NFL_NONPICK_24H:${POOL_ID}:partial:${WEEK}`,
            `notifications/NFL_NONPICK_4H:${POOL_ID}:joined-never-picked:${WEEK}`,
        ]);
    });

    it('honours the commissioner off-switch (reminders.lock.enabled === false)', async () => {
        const { db, store, pool } = seedPool('NFL_PICKEM');
        await checkNFLNonPickerReminders(db, { ...pool, reminders: { lock: { enabled: false } } }, NOW);
        expect(mailTo(store)).toEqual([]);
    });

    it('per-game pools say the FIRST game locks; weekly pools say the week locks', async () => {
        const perGame = seedPool('NFL_PICKEM', { lockMode: 'PER_GAME' });
        await checkNFLNonPickerReminders(perGame.db, perGame.pool, NOW);
        const perGameHtml = [...perGame.store.entries()].find(([k]) => k.startsWith('mail/'))![1].message.html as string;
        expect(perGameHtml).toContain("Week 1's first game locks:");

        const weekly = seedPool('NFL_PICKEM', { lockMode: 'WEEKLY' });
        await checkNFLNonPickerReminders(weekly.db, weekly.pool, NOW);
        const weeklyHtml = [...weekly.store.entries()].find(([k]) => k.startsWith('mail/'))![1].message.html as string;
        expect(weeklyHtml).toContain('Week 1 locks:');
    });

    it('survivor: a roster-only member is reminded and the hard-lock freeze is still written first', async () => {
        const { db, store, pool } = seedPool('NFL_SURVIVOR');
        // Survivor entries key picks by week; 'complete' has week 1, 'partial' does not.
        store.set(`pools/${POOL_ID}/entries/complete`, { id: 'complete', ownerUid: 'complete', status: 'ALIVE', picks: { 1: 'SEA' } });
        store.set(`pools/${POOL_ID}/entries/partial`, { id: 'partial', ownerUid: 'partial', status: 'ALIVE', picks: {} });
        await checkNFLNonPickerReminders(db, pool, NOW);
        expect(mailTo(store)).toEqual(['joined-never-picked@example.com', 'partial@example.com']);
        expect(store.get(`pools/${POOL_ID}`)?.[`hardLockByWeek.${WEEK}`]).toBeTypeOf('number');
    });
});
