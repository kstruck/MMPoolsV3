// @vitest-environment jsdom
//
// Bracket standings owner names — Sentry c810a0012edf4755ba408bcb1be0a279.
//
// THE DEFECT THIS PINS. The dashboard built its uid -> name map by calling
// `userRepository.getById(uid)` for every distinct entry owner. `users/{uid}`
// is readable only by that user (or a super admin), so an ordinary member got
// permission-denied once per OTHER member — and `BaseRepository.getById`
// reports every one of them through `errorHandler.handleError`, i.e. one Sentry
// event AND one `logClientError` callable + Firestore write per other member
// per page load. Standings then showed "Unknown" for everyone else anyway.
//
// WHY jsdom. The last property under test is about what a reader SEES — that a
// raw Firebase uid never reaches the screen. `billingGate.test.tsx` documents
// why the repo default is the node environment and why a suite buys jsdom only
// when it must; asserting on rendered text is one of those cases.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// Vite's `?raw` import rather than node:fs — this file is transformed for a
// browser target, where `import.meta.url` is an http URL (fileURLToPath throws
// on it) and `node:fs`/`process` are not in the app tsconfig's `types`.
import bracketPoolDashboardSource from './BracketPoolDashboard.tsx?raw';

vi.mock('../../firebase', () => ({ auth: {}, db: {}, functions: {} }));

/**
 * Firestore is stubbed at the SDK boundary rather than by replacing dbService,
 * so `dbService.getPublicProfile` — the line that decides WHICH COLLECTION the
 * dashboard reads, i.e. the whole fix — runs for real and its document path is
 * observable. `doc()` returns the path it was handed; `getDoc()` answers from
 * `docReads`, which a test can also make THROW to stand in for the
 * permission-denied the old `users/{uid}` read produced in production.
 */
const docReads = vi.fn<(path: string) => { exists: () => boolean; data: () => unknown }>();

vi.mock('firebase/firestore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('firebase/firestore')>();
    return {
        ...actual,
        doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
        getDoc: async (ref: { __path: string }) => docReads(ref.__path),
        onSnapshot: () => () => {},
    };
});

import { resolveOwnerNames, OWNER_NAME_FALLBACK, type OwnerNameProfile } from './ownerNames';
import { dbService } from '../../services/dbService';
import { StandingsTable } from './StandingsTable';
import type { BracketEntry, BracketPool, Tournament } from '../../types';

afterEach(() => {
    cleanup();
    docReads.mockReset();
});

/** A uid shaped like the real thing — 28 opaque characters, meaningless to a reader. */
const UID_A = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqR';
const UID_B = 'z9Y8x7W6v5U4t3S2r1Q0pOnMlKjI';

const entry = (id: string, ownerUid: string, name: string): BracketEntry => ({
    id,
    poolId: 'pool-1',
    ownerUid,
    name,
    picks: {},
    status: 'SUBMITTED',
    paidStatus: 'UNPAID',
    score: 0,
    createdAt: 0,
    updatedAt: 0,
});

/** A fetcher over a fixed table. Records every uid it was asked for. */
const fetcherOver = (table: Record<string, OwnerNameProfile | null>) => {
    const calls: string[] = [];
    const fetch = async (uid: string) => {
        calls.push(uid);
        return table[uid] ?? null;
    };
    return { fetch, calls };
};

describe('resolveOwnerNames', () => {
    it('resolves the name from publicProfiles, and asks for nothing else', async () => {
        const { fetch, calls } = fetcherOver({
            [UID_A]: { userName: 'Ada Lovelace' },
            [UID_B]: { userName: 'Grace Hopper' },
        });

        const map = await resolveOwnerNames(
            [entry('e1', UID_A, 'Ada Bracket'), entry('e2', UID_B, 'Grace Bracket')],
            fetch
        );

        expect(map).toEqual({ [UID_A]: 'Ada Lovelace', [UID_B]: 'Grace Hopper' });
        // The profile fetcher is the ONLY data source the resolver has — there is
        // no `users/` path left for it to take even if a profile is missing.
        expect(calls.sort()).toEqual([UID_A, UID_B].sort());
    });

    it('asks once per OWNER, not once per entry', async () => {
        // Multi-entry pools are the common case, and the pre-fix code deduped too.
        // Losing that would multiply the read count by the entry cap.
        const { fetch, calls } = fetcherOver({ [UID_A]: { userName: 'Ada Lovelace' } });

        await resolveOwnerNames(
            [entry('e1', UID_A, 'Bracket 1'), entry('e2', UID_A, 'Bracket 2'), entry('e3', UID_A, 'Bracket 3')],
            fetch
        );

        expect(calls).toEqual([UID_A]);
    });

    it('falls back to the entry name when the profile does not exist', async () => {
        // Real, not hypothetical: publicProfiles docs are written by
        // recomputeUserProfile on entry writes, so entries submitted before that
        // trigger shipped have no profile doc at all.
        const { fetch } = fetcherOver({ [UID_A]: null });

        const map = await resolveOwnerNames([entry('e1', UID_A, 'Ada Bracket')], fetch);

        expect(map[UID_A]).toBe('Ada Bracket');
    });

    it('falls back to the entry name when the profile carries a blank userName', async () => {
        // `userName: ''` and `'   '` are present-but-useless. A truthiness check
        // would pass the empty string straight through to the standings row.
        const { fetch } = fetcherOver({ [UID_A]: { userName: '   ' }, [UID_B]: { userName: '' } });

        const map = await resolveOwnerNames(
            [entry('e1', UID_A, 'Ada Bracket'), entry('e2', UID_B, 'Grace Bracket')],
            fetch
        );

        expect(map).toEqual({ [UID_A]: 'Ada Bracket', [UID_B]: 'Grace Bracket' });
    });

    it("falls back to 'Unknown' when neither profile nor entry name is usable", async () => {
        const { fetch } = fetcherOver({ [UID_A]: null });

        const map = await resolveOwnerNames([entry('e1', UID_A, '  ')], fetch);

        expect(map[UID_A]).toBe(OWNER_NAME_FALLBACK);
        expect(map[UID_A]).toBe('Unknown');
    });

    it('NEVER falls back to the raw uid', async () => {
        // 🛑 The pre-fix chain ended `|| uniqueUids[i]`, so a member with neither
        // a name nor an email on their user doc was shown to the whole pool as a
        // 28-character Firebase id.
        const { fetch } = fetcherOver({ [UID_A]: null, [UID_B]: { userName: '' } });

        const map = await resolveOwnerNames(
            [entry('e1', UID_A, ''), entry('e2', UID_B, '   ')],
            fetch
        );

        expect(Object.values(map)).toEqual([OWNER_NAME_FALLBACK, OWNER_NAME_FALLBACK]);
        expect(Object.values(map)).not.toContain(UID_A);
        expect(Object.values(map)).not.toContain(UID_B);
    });

    it('lets one failed profile read cost only that one name', async () => {
        // The pre-fix code was a bare `Promise.all(...).catch()`: the FIRST
        // rejection discarded every name in the pool, including the ones that
        // had already resolved.
        const fetch = async (uid: string) => {
            if (uid === UID_A) throw new Error('offline');
            return { userName: 'Grace Hopper' };
        };

        const map = await resolveOwnerNames(
            [entry('e1', UID_A, 'Ada Bracket'), entry('e2', UID_B, 'Grace Bracket')],
            fetch
        );

        expect(map[UID_B]).toBe('Grace Hopper');
        expect(map[UID_A]).toBe('Ada Bracket');
    });
});

describe('dbService.getPublicProfile', () => {
    it('reads publicProfiles/{uid} — never users/{uid}', async () => {
        docReads.mockReturnValue({ exists: () => true, data: () => ({ userName: 'Ada Lovelace' }) });

        const profile = await dbService.getPublicProfile(UID_A);

        expect(docReads).toHaveBeenCalledWith(`publicProfiles/${UID_A}`);
        // The exact read that produced the Sentry issue. `users/{uid}` is
        // own-or-super-admin only (firestore.rules), `publicProfiles/{uid}` is
        // `allow read: if true`.
        expect(docReads).not.toHaveBeenCalledWith(`users/${UID_A}`);
        expect(profile?.userName).toBe('Ada Lovelace');
        expect(profile?.uid).toBe(UID_A);
    });

    it('returns null for a document that does not exist', async () => {
        docReads.mockReturnValue({ exists: () => false, data: () => ({}) });

        expect(await dbService.getPublicProfile(UID_A)).toBeNull();
    });

    it('returns null rather than throwing when the read is refused', async () => {
        // A refused read must stay a NON-EVENT: no throw for a caller to report,
        // and (unlike BaseRepository.getById) no errorHandler round trip. That
        // round trip is what cost one Sentry event plus one logClientError
        // callable + Firestore write per other member, per page load.
        docReads.mockImplementation(() => {
            throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        });

        expect(await dbService.getPublicProfile(UID_A)).toBeNull();
    });
});

describe('BracketPoolDashboard name resolution', () => {
    it('does not read the users collection for other members', () => {
        // A behavioural render of BracketPoolDashboard is not reachable here (it
        // pulls the router, the toast provider, billing and a dozen tabs), so the
        // property is pinned where it actually lives: the module must not hold a
        // handle on userRepository at all. `userRepository.getById(otherUid)` IS
        // the permission-denied read, and re-adding the import is the only way
        // back to it.
        const source = bracketPoolDashboardSource;
        // Guard the guard: an import that resolved to nothing would make every
        // assertion below vacuous (`''` contains no forbidden string either).
        expect(source).toContain('export const BracketPoolDashboard');

        expect(source).not.toContain('userRepository');
        expect(source).toContain('resolveOwnerNames');
    });
});

describe('StandingsTable', () => {
    const tournament = {
        id: 'mens-2026',
        seasonYear: 2026,
        gender: 'mens',
        isFinalized: false,
        games: {},
        slots: {},
    } as unknown as Tournament;

    const pool = {
        id: 'pool-1',
        settings: { entryFee: 0, scoringSystem: 'CLASSIC' },
    } as unknown as BracketPool;

    it('shows the resolved name, and never the raw uid', async () => {
        const rows = [entry('e1', UID_A, 'Ada Bracket')];
        const userNames = await resolveOwnerNames(rows, async () => ({ userName: 'Ada Lovelace' }));

        render(<StandingsTable entries={rows} pool={pool} tournament={tournament} userNames={userNames} />);

        expect(screen.getByText('Ada Lovelace')).toBeTruthy();
        expect(screen.queryByText(UID_A)).toBeNull();
        expect(document.body.textContent).not.toContain(UID_A);
    });

    it("shows 'Unknown' rather than a uid when nothing resolves", async () => {
        const rows = [entry('e1', UID_A, '')];
        const userNames = await resolveOwnerNames(rows, async () => null);

        render(<StandingsTable entries={rows} pool={pool} tournament={tournament} userNames={userNames} />);

        expect(screen.getByText('Unknown')).toBeTruthy();
        expect(document.body.textContent).not.toContain(UID_A);
    });
});
