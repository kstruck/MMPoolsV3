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

type Data = Record<string, unknown>;
type Filter = [string, string, unknown];
type SetOpts = { merge?: boolean; mergeFields?: unknown };

interface FakeSnap { id: string; exists: boolean; data: () => Data | undefined }
interface FakeDocRef {
    id: string;
    path: string;
    get: () => Promise<FakeSnap>;
    set: (data: Data, opts?: SetOpts) => Promise<void>;
    update: (data: Data) => Promise<void>;
    collection: (name: string) => FakeColRef;
}
interface FakeColRef {
    where: (f: string, op: string, v: unknown) => FakeColRef;
    limit: (n?: number) => FakeColRef;
    doc: (id?: string) => FakeDocRef;
    add: (data: Data) => Promise<FakeDocRef>;
    get: () => Promise<{ docs: FakeSnap[]; empty: boolean; size: number }>;
}
interface FakeTx {
    get: (ref: FakeDocRef) => Promise<FakeSnap>;
    set: (ref: FakeDocRef, data: Data, opts?: SetOpts) => void;
    update: (ref: FakeDocRef, data: Data) => void;
}
interface FakeDb {
    collection: (name: string) => FakeColRef;
    doc: (path: string) => FakeDocRef;
    runTransaction: <T>(fn: (tx: FakeTx) => Promise<T>) => Promise<T>;
}

/** Minimal path-keyed Firestore stand-in: enough surface for the reminder pass. */
function makeDb() {
    const store = new Map<string, Data>();
    let autoId = 0;
    const nextId = () => `auto${++autoId}`;
    const lastSegment = (path: string) => path.split('/').pop() ?? path;

    const matches = (data: Data, [f, op, v]: Filter) => {
        const actual = data[f];
        if (op === '==') return actual === v;
        if (op === '>') return (actual as number) > (v as number);
        if (op === 'in') return (v as unknown[]).includes(actual);
        throw new Error(`fake db: unsupported op ${op}`);
    };

    const docRef = (path: string): FakeDocRef => ({
        id: lastSegment(path),
        path,
        get: async () => ({ id: lastSegment(path), exists: store.has(path), data: () => store.get(path) }),
        set: async (data, opts) => {
            store.set(path, opts?.merge || opts?.mergeFields ? { ...(store.get(path) ?? {}), ...data } : { ...data });
        },
        update: async (data) => {
            const existing = store.get(path);
            if (!existing) throw new Error(`fake db: update of missing doc ${path}`);
            store.set(path, { ...existing, ...data });
        },
        collection: (name) => colRef(`${path}/${name}`, []),
    });

    const colRef = (path: string, filters: Filter[]): FakeColRef => ({
        where: (f, op, v) => colRef(path, [...filters, [f, op, v]]),
        limit: () => colRef(path, filters),
        doc: (id) => docRef(`${path}/${id ?? nextId()}`),
        add: async (data) => { const ref = docRef(`${path}/${nextId()}`); await ref.set(data); return ref; },
        get: async () => {
            const depth = path.split('/').length + 1;
            const docs = [...store.entries()]
                .filter(([p]) => p.startsWith(`${path}/`) && p.split('/').length === depth)
                .filter(([, d]) => filters.every(fl => matches(d, fl)))
                .map(([p, d]) => ({ id: lastSegment(p), data: () => d, exists: true }));
            return { docs, empty: docs.length === 0, size: docs.length };
        },
    });

    const db: FakeDb = {
        collection: (name) => colRef(name, []),
        doc: (path) => docRef(path),
        runTransaction: (fn) => fn({
            get: (ref) => ref.get(),
            set: (ref, data, opts) => { void ref.set(data, opts); },
            update: (ref, data) => { void ref.update(data); },
        }),
    };
    // The production signature wants admin.firestore.Firestore; the double
    // implements the handful of members the reminder pass touches.
    return { db: db as unknown as Parameters<typeof checkNFLNonPickerReminders>[0], store, seed: (path: string, data: Data) => store.set(path, data) };
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
    return { ...f, pool: pool as unknown as ReminderPool };
}

type ReminderPool = Parameters<typeof checkNFLNonPickerReminders>[1];
type MailDoc = { to: string; poolId?: string; category?: string; message: { subject: string; html: string } };

const notificationKeys = (store: Map<string, Data>) => [...store.keys()].filter(k => k.startsWith('notifications/')).sort();
const mailDocs = (store: Map<string, Data>) => [...store.entries()].filter(([k]) => k.startsWith('mail/')).map(([, d]) => d as unknown as MailDoc);
const mailTo = (store: Map<string, Data>) => mailDocs(store).map(m => m.to).sort();

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

        const mail = mailDocs(store)[0];
        // Default straight Pick'em resolves to PER_GAME (shared/nflLockMode), so
        // the subject names the first game, not the week.
        expect(mail.message.subject).toBe("You haven't picked yet — Week 1's first game locks in ~20 hours");
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
        await checkNFLNonPickerReminders(db, { ...pool, reminders: { lock: { enabled: false } } } as unknown as ReminderPool, NOW);
        expect(mailTo(store)).toEqual([]);
    });

    it('per-game pools say the FIRST game locks; weekly pools say the week locks — subject AND body', async () => {
        const perGame = seedPool('NFL_PICKEM', { lockMode: 'PER_GAME' });
        await checkNFLNonPickerReminders(perGame.db, perGame.pool, NOW);
        const perGameMail = mailDocs(perGame.store)[0];
        expect(perGameMail.message.html).toContain("Week 1's first game locks:");
        expect(perGameMail.message.subject).toContain("Week 1's first game locks in");

        const weekly = seedPool('NFL_PICKEM', { lockMode: 'WEEKLY' });
        await checkNFLNonPickerReminders(weekly.db, weekly.pool, NOW);
        const weeklyMail = mailDocs(weekly.store)[0];
        expect(weeklyMail.message.html).toContain('Week 1 locks:');
        expect(weeklyMail.message.subject).toContain('Week 1 locks in');

        // Last call keeps the same distinction.
        const lastCall = seedPool('NFL_PICKEM', { lockMode: 'PER_GAME' });
        await checkNFLNonPickerReminders(lastCall.db, lastCall.pool, KICKOFF - 5 * 60 * 1000 - 2 * HOUR);
        expect(mailDocs(lastCall.store)[0].message.subject).toBe("Last call: Week 1's first game locks soon — Donkeys Test");
    });

    it('a stamped confidence pool applies the KICKOFF CEILING to a commissioner extension (qodo #689 finding 2)', async () => {
        // Extension 10h past kickoff. Without the ceiling the "deadline" sits
        // 30h out and no tier fires; with it the deadline is kickoff itself,
        // 20h out — exactly what the server enforces for a stamped confidence pool.
        const override = { 1: KICKOFF + 10 * HOUR };
        const confidence = seedPool('NFL_PICKEM', { confidenceMode: true, lockRuleVersion: 2, lockMode: 'PER_GAME', weekLockOverrides: override });
        await checkNFLNonPickerReminders(confidence.db, confidence.pool, NOW);
        expect(mailTo(confidence.store)).toEqual(['joined-never-picked@example.com', 'partial@example.com']);

        // Straight Pick'em keeps its documented semantics: an extension CAN push
        // the deadline past kickoff, so at NOW the lock is 30h away and silent.
        const straight = seedPool('NFL_PICKEM', { lockMode: 'PER_GAME', weekLockOverrides: override });
        await checkNFLNonPickerReminders(straight.db, straight.pool, NOW);
        expect(mailTo(straight.store)).toEqual([]);
    });

    it('a CANCELLED opener does not silence the week: the deadline moves to the first playable game (codex r2 on #689)', async () => {
        // g1 cancelled before kickoff; g2 (3 days later) is now the first playable
        // game. At NOW (20h before g1) nothing is due; 20h before g2 the 24H tier fires.
        const cancelled = () => {
            const f = seedPool('NFL_PICKEM', { confidenceMode: true, lockRuleVersion: 2, lockMode: 'PER_GAME' });
            f.store.set('nfl_games/g1', { id: 'g1', season: '2026', seasonType: 2, week: WEEK, startTime: KICKOFF, status: 'CANCELLED' });
            return f;
        };
        const early = cancelled();
        await checkNFLNonPickerReminders(early.db, early.pool, NOW);
        expect(notificationKeys(early.store)).toEqual([]);

        const later = cancelled();
        const g2Kickoff = KICKOFF + 3 * 24 * HOUR;
        await checkNFLNonPickerReminders(later.db, later.pool, g2Kickoff - 5 * 60 * 1000 - 20 * HOUR);
        expect(mailTo(later.store)).toEqual(['joined-never-picked@example.com', 'partial@example.com']);
        expect(mailDocs(later.store)[0].message.subject).toContain('locks in ~20 hours');

        // Every game cancelled: nothing to pick, nothing to send.
        const none = cancelled();
        none.store.set('nfl_games/g2', { id: 'g2', season: '2026', seasonType: 2, week: WEEK, startTime: g2Kickoff, status: 'CANCELLED' });
        await checkNFLNonPickerReminders(none.db, none.pool, g2Kickoff - 5 * 60 * 1000 - 20 * HOUR);
        expect(notificationKeys(none.store)).toEqual([]);
    });

    it('a stamped confidence pool whose first game has left SCHEDULED is locked, whatever the moved startTime says', async () => {
        // Feed correction after real kickoff: startTime now reads 2h ahead (inside
        // the 4H window by the clock) but the game is IN_PROGRESS. Status wins.
        const confidence = seedPool('NFL_PICKEM', { confidenceMode: true, lockRuleVersion: 2, lockMode: 'PER_GAME' });
        confidence.store.set('nfl_games/g1', { id: 'g1', season: '2026', seasonType: 2, week: WEEK, startTime: NOW + 2 * HOUR, status: 'IN_PROGRESS' });
        await checkNFLNonPickerReminders(confidence.db, confidence.pool, NOW);
        expect(notificationKeys(confidence.store)).toEqual([]);

        // A straight Pick'em pool keeps the clock-only rule and still sends last call.
        const straight = seedPool('NFL_PICKEM', { lockMode: 'PER_GAME' });
        straight.store.set('nfl_games/g1', { id: 'g1', season: '2026', seasonType: 2, week: WEEK, startTime: NOW + 2 * HOUR, status: 'IN_PROGRESS' });
        await checkNFLNonPickerReminders(straight.db, straight.pool, NOW);
        expect(notificationKeys(straight.store).every(k => k.includes('NFL_NONPICK_4H:'))).toBe(true);
        expect(notificationKeys(straight.store)).toHaveLength(2);
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
