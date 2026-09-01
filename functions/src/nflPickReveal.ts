/**
 * getPoolPicks — the ONE door a commissioner reads other members' picks through.
 *
 * PLAN-COMMISSIONER-BLIND-PICKS T2. Before this, a pool's owner and manager
 * could read every entry document in the pool at any time straight from
 * `firestore.rules`, which meant they saw everyone's picks before kickoff. T3
 * removes those two principals from the entries read rule; this callable is what
 * replaces them, and it is the one genuinely dangerous artifact in that plan.
 *
 * Why a callable and not a cleverer rule: an entry document bundles EVERY week's
 * picks, so no document-level rule can say "week 4 yes, week 5 no". Same reason
 * participants were moved to the standings projection in ADR 0005 Phase 2.
 *
 * Authorization, in words (WIDENED 2026-08-14 — see below):
 *   - SUPER_ADMIN            → every pick, every week, any time (Kevin's ruling).
 *   - pool owner / manager   → pick CONTENT only for the games whose effective
 *                              lock has passed, plus per-member pick COUNTS at
 *                              any time (the roster's completeness column).
 *   - a MEMBER with a canonical Member Record
 *                            → the SAME pick content, on the SAME boundary, and
 *                              NO counts until the whole week reveals.
 *   - anyone else            → permission-denied.
 *
 * 🛑 THE MEMBER PRINCIPAL REVERSES `PLAN-COMMISSIONER-BLIND-PICKS` Q5, which
 * read *"Does anything change for ordinary members? No."* Kevin's ruling of
 * 2026-08-14 — *"make it visible for all users if pool is locked"* —
 * supersedes it (`PLAN-MEMBER-PICKS-VISIBILITY`).
 *
 * ⚠️ What did NOT change is the TIMING. The widening is about WHO, never WHEN:
 * a member is handed the SAME `weekRevealFor` result a commissioner gets, so
 * there is still exactly one definition of "locked" in the system.
 *
 * ⚠️ The response is assembled by ALLOWLIST of revealed game ids, never by
 * filtering a copy of the entry. A mixed-locked pick'em week is the case that
 * matters: one game kicked off, fifteen not, and a week-granular answer would
 * leak all sixteen.
 */

import * as admin from "firebase-admin";
import { isPoolCommissioner } from './poolOps';
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { assertCallerRole } from "./lib/assertRole";
import { getPoolPicksSchema } from "./schemas/pickReveal";
import { weekRevealFor, fullReveal, weekPickCount, pickProgressFor, type WeekReveal, type PickProgress } from "./lib/pickReveal";
import { rosterSummaryRef } from "./lib/rosterSummary";
// The SERVER-STAMPED half of the membership evidence. Deliberately NOT
// `isProvableMember`, which also accepts the manager-writable participantIds
// array — see `assertPickReader`'s header for why that distinction is the
// whole point here.
import { isCanonicalMemberRecord } from "./shared/memberRecord";
import type { NFLGame } from "./nflPoolTypes";

const NFL_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];

/**
 * Documented product ceilings (PLAN-API-TRUST-BOUNDARY Phase 4, Q3).
 *
 * REVEAL_ENTRY_CAP is the per-request WORK bound on the entries scan. It is
 * NOT claimed unreachable (entitlements permit 9,999 players × 10 entries);
 * it is the ceiling the reveal surface supports, and overflow fails LOUD —
 * a silently truncated reveal would corrupt counts/progress for everyone.
 *
 * REVEAL_RESPONSE_BYTE_BUDGET is the TRANSPORT bound, measured on the
 * serialized response in UTF-8 BYTES (not UTF-16 code units — a multibyte
 * entry name must not slip past it). Worst legal Pick'em entry ≈ 25 KB of
 * maps (≤50 picks + ≤50 confidence, 100-char strings), so a below-cap pool
 * can still exceed the ~10 MB callable limit; 8 MB keeps margin.
 */
export const REVEAL_ENTRY_CAP = 2_000;
export const REVEAL_RESPONSE_BYTE_BUDGET = 8_000_000;

export interface PoolPicksResponse {
    week: number;
    mode: 'WEEK' | 'PER_GAME';
    /** Game ids whose picks are included below. The client renders nothing else. */
    revealedGameIds: string[];
    weekRevealed: boolean;
    /** Every game in the week's slate, so the client can size completeness. */
    weekGameIds: string[];
    /**
     * ENTRY id → how many of this week's games that entry has saved a pick for.
     *
     * 🛑 KEYED BY THE ENTRY DOCUMENT ID, NOT THE OWNER'S UID (PLAN-MULTI-ENTRY
     * D5). For entry #1 the two are the same string, so every existing pool and
     * every existing client read is byte-for-byte unchanged; for a player's
     * second entry (`e2:{uid}`) a uid key would silently overwrite the first —
     * the invisible merge R1 names. Clients index these maps by `row.id`
     * (enforced by `tests/nfl-surface-invariants.test.ts`).
     */
    counts: Record<string, number>;
    /** entry id → { gameId|week → team }, revealed keys only. */
    picks: Record<string, Record<string, string>>;
    /** entry id → { gameId → points }, revealed keys only. Pick'em confidence mode. */
    confidence: Record<string, Record<string, number>>;
    /**
     * entry id → this week's MNF tiebreaker guess. Included ONLY once the whole week
     * is revealed: a predicted combined score is a per-week secret with no game
     * to attach it to, so a partly-locked week must not carry it. It is excluded
     * from the standings projection by allowlist for the same reason
     * (`buildStandingsRows`), which is why it has to come through this door.
     */
    tiebreakers: Record<string, number>;
    /**
     * entry id → who owns it and what it is called (PLAN-MULTI-ENTRY D5).
     * Additive: absent for every principal that is not entitled to it.
     *
     * 🛑 GATED ON THE REVEAL FOR A PARTICIPANT, ALWAYS PRESENT FOR THE
     * COMMISSIONER AND SUPER_ADMIN. Enumerating which of a rival's entries
     * exist — and what they are named — before the week reveals is per-entry
     * metadata a participant has no claim on (D5 / the T3 acceptance row).
     * A participant already learns entry EXISTENCE from the Member Record
     * roster map, which is a different fact from "these ids are in this
     * week's reveal payload", and nothing here renders blank without it.
     *
     * ⚠️ This is a WHO gate, never a WHEN one: `weekRevealFor` is untouched and
     * remains the single definition of the boundary.
     */
    entries?: Record<string, { ownerUid: string; entryName?: string }>;
    /**
     * The pool-wide completion fraction — "12 of 16 players have their picks in".
     * `PLAN-MEMBER-PICK-PROGRESS`.
     *
     * 🛑 THE ONE FIELD HERE THAT IS THE SAME FOR EVERY PRINCIPAL. `counts`,
     * `picks`, `confidence` and `tiebreakers` are all narrowed by who is asking;
     * this is not, deliberately, because it names nobody — it counts finished
     * sheets rather than stating a fact about any member. A gate on it would be a
     * SECOND definition of the reveal boundary, which is what
     * PLAN-COMMISSIONER-BLIND-PICKS exists to prevent. An emulator test asserts a
     * participant and a commissioner receive identical values.
     *
     * `{complete: 0, total: 0}` means "we cannot answer" — no schema-2
     * `rosterSummary`, or a week with no games. The client renders nothing.
     */
    progress: PickProgress;
}

/**
 * Who may read this pool's picks, and as WHAT.
 *
 * Three principals now, where #414 had two:
 *   SUPER_ADMIN            → everything, every week, any time.
 *   pool owner / manager   → the reveal boundary, plus live per-member COUNTS.
 *   proven PARTICIPANT     → the reveal boundary, and NO counts until the week
 *                            reveals (PLAN-MEMBER-PICKS-VISIBILITY K1).
 *
 * 🛑 THE PARTICIPANT BRANCH CHANGES **WHO**, NEVER **WHEN**. Kevin's ask was
 * *"visible for all users if pool is locked"*, and `weekRevealFor` below already
 * computes exactly that per pool type. A participant is handed the SAME reveal a
 * commissioner gets, from the same call — there is deliberately no second
 * definition of "locked" anywhere in this function or on the client.
 *
 * ⚠️ THE COMMISSIONER BRANCH IS `isPoolCommissioner` — DELIBERATELY, AS OF
 * PLAN-CO-COMMISSIONERS C7 (Kevin, K4 = Yes, 2026-08-15). This header used to
 * forbid exactly that: `coManagers` was an unvetted, client-writable array, so
 * admitting it would have been a WIDER door to pre-lock completion COUNTS than
 * the rule this callable replaced (codex r1 on #414). That objection is
 * answered, not overruled: the array is server-owned now (rules lock, #444) and
 * its ONLY writer is `setPoolCoCommissioner`, which the owner calls per uid,
 * for canonical members of NFL pools only. A co-commissioner named that way IS
 * a commissioner for the purpose CONTEXT.md §Pick Reveal names — "chasing
 * missing picks is the Commissioner's job" — so they see "14 of 16 Picks Set"
 * before lock, and departed members' entries, exactly as the owner does. What
 * they still do NOT get: anything on WHEN a pick is revealed (`weekRevealFor`
 * is untouched), and `createdByUid` on its own still buys nothing here.
 *
 * 🛑 MEMBERSHIP HERE IS A **CANONICAL MEMBER RECORD**, NOT `isProvableMember`.
 *
 * That is a deliberate narrowing and it is the whole point. `isProvableMember`
 * accepts EITHER a canonical record OR the pool's `participantIds` array, and
 * that array was CLIENT-WRITABLE BY A MANAGER until this change. Kevin's K9
 * ruling protects it in `firestore.rules` — but a rule only governs FUTURE
 * writes. Every pool that existed before that deploy carries an array a manager
 * could already have added anyone to, and locking the door does not evict who is
 * inside. Anyone so added would gain a durable, self-refreshing feed of every
 * future reveal. (codex r10; Kevin's ruling on it, 2026-08-14.)
 *
 * `joinedAt` is the discriminator and no client path can write it — every
 * SERVER join path stamps it, and `firestore.rules` allows a client to touch
 * only `memberReportedPaid`/`memberReportedAt` on this collection. So a
 * canonical record is evidence a real join happened, which the array is not.
 *
 * ⚠️ THE COST, STATED PLAINLY: a member of a legacy or partially-backfilled
 * pool whose Member Record predates the roster work sees nothing here until a
 * server path writes them one. They keep every other member capability; only
 * this read is withheld. That is the trade Kevin took over leaving a
 * pre-existing grant standing.
 *
 * ⚠️ Do NOT "simplify" this back to `isProvableMember` to match the roster
 * surfaces. It reads the same collection and answers a WIDER question on
 * purpose; this callable is the one place where the array is not good enough.
 */
type PickReaderKind = 'SUPER_ADMIN' | 'COMMISSIONER' | 'PARTICIPANT';

async function assertPickReader(
    pool: { ownerId?: string; managerUid?: string; participantIds?: unknown },
    request: { auth?: { uid: string; token: Record<string, unknown> } | null },
    poolId: string,
    db: admin.firestore.Firestore,
): Promise<{ kind: PickReaderKind; isSuperAdmin: boolean }> {
    const uid = request.auth!.uid;
    const claimsSuperAdmin = (request.auth!.token as { role?: string })?.role === 'SUPER_ADMIN';

    // ⚠️ THE CLAIM ALONE IS NOT PROOF. `assertCallerRole` exists precisely
    // because a demoted-but-not-yet-refreshed token keeps its old `role` claim
    // until it expires — and the SUPER_ADMIN branch of this callable returns
    // EVERY member's picks regardless of reveal timing. Trusting the claim would
    // leave a stale token with full pre-kickoff pick access on the one door this
    // plan built to close it. Claim AND `users/{uid}.role` must agree.
    // (qodo #6 on this PR.)
    //
    // A failed check is NOT fatal on its own: a demoted admin who is still this
    // pool's owner keeps the owner's boundary-limited view, which is exactly
    // what they would have with no claim at all. Demotion costs the elevated
    // read, not the pool they own.
    if (claimsSuperAdmin) {
        try {
            await assertCallerRole(request, 'SUPER_ADMIN');
            return { kind: 'SUPER_ADMIN', isSuperAdmin: true };
        } catch {
            // fall through to the owner/manager test below
        }
    }

    if (isPoolCommissioner(pool, uid)) {
        return { kind: 'COMMISSIONER', isSuperAdmin: false };
    }

    // The participant branch. One document read, and only for a caller who is
    // neither admin nor commissioner — the two hot paths pay nothing for it.
    const memberSnap = await db.collection('pools').doc(poolId).collection('members').doc(uid).get();
    if (isCanonicalMemberRecord(memberSnap.data())) {
        return { kind: 'PARTICIPANT', isSuperAdmin: false };
    }

    throw new HttpsError('permission-denied', 'Only this pool\'s members can read the pool\'s picks.');
}

export const getPoolPicks = validated(
    { schema: getPoolPicksSchema, label: "getPoolPicks", appCheck: "monitor" },
    async (input, request): Promise<PoolPicksResponse> => {
        const db = admin.firestore();
        const { poolId, week } = input;

        const poolSnap = await db.collection('pools').doc(poolId).get();
        if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
        const pool = poolSnap.data() as any;

        // Scoped to the three NFL season types on purpose (D4). Bracket and
        // playoff pools are single-lock and reveal everything post-lock by
        // design; they never lost their raw read and must not gain a second door.
        if (!NFL_TYPES.includes(pool.type)) {
            throw new HttpsError('failed-precondition', 'getPoolPicks is only available for NFL season pools.');
        }

        const { kind, isSuperAdmin } = await assertPickReader(pool, request, poolId, db);
        const isParticipant = kind === 'PARTICIPANT';

        // 🛑 A DEPARTED MEMBER'S PICKS ARE NOT SERVED TO A CURRENT ONE (D7/K8).
        //
        // Removing a member deletes their Member Record and pulls them from
        // `participantIds` (`lib/memberRecord.ts`) — it does NOT delete their
        // entry document. This function iterates the whole `entries` collection,
        // so before this filter it would hand a participant the picks of someone
        // the pool no longer lists. That was harmless while only the
        // commissioner and SUPER_ADMIN could call it; admitting participants is
        // exactly what turns it into one member's data reaching another.
        //
        // ⚠️ PARTICIPANT ONLY. Applying it to every principal would silently
        // narrow a privileged API and contradict `fullReveal`'s "SUPER_ADMIN
        // gets everything, always". A commissioner still sees a departed
        // player's entry, which is what they see today. (codex r2 on the plan.)
        // ⚠️ FILTERED FROM `participantIds`, WHICH COSTS NOTHING — the pool doc
        // is already loaded. An earlier revision read the WHOLE `members`
        // subcollection per call, an O(roster) read added on top of the entries
        // scan, on a path every member now polls. (qodo, re-review.)
        //
        // Safe to use HERE and not for admission: K9 made the array
        // server-owned (`firestore.rules`), and "is this person still on the
        // pool's roster" is exactly the question it answers — removal does
        // `arrayRemove(uid)` on it. The CALLER gate stays strictly a canonical
        // Member Record, because that one has to survive the entries that
        // predate the lock.
        const roster: unknown = pool.participantIds;
        const stillAMember: ((uid: string) => boolean) | null = isParticipant && Array.isArray(roster)
            ? (uid: string) => (roster as string[]).includes(uid)
            : null;

        // The week's slate — same query the submit path and the scorer use, so
        // the reveal boundary is computed over exactly the games that count.
        const gamesSnap = await db.collection('nfl_games')
            .where('season', '==', pool.season)
            .where('seasonType', '==', Number(pool.seasonType || 2))
            .where('week', '==', week)
            .get();
        const games = gamesSnap.docs.map(d => d.data() as NFLGame)
            .map(g => ({ id: g.id, startTime: g.startTime }));

        const reveal: WeekReveal = isSuperAdmin
            ? fullReveal(pool, games)
            : weekRevealFor(pool, week, games, Date.now());

        // ALLOWLIST. Built once, consulted per key. For Survivor/Margin the pick
        // is keyed by the week number rather than a game id, so the week's own
        // key joins the allowlist only when the WHOLE week is revealed — a
        // single kicked-off game must not expose a weekly pick.
        const allowedKeys = new Set<string>(reveal.revealedGameIds);
        if (reveal.weekRevealed) allowedKeys.add(String(week));

        const weekGameIds = games.map(g => g.id);

        // FIELD-MASKED READ. An entry document bundles the WHOLE SEASON's picks,
        // and the manager dashboard polls this callable every 60 seconds — so an
        // unmasked read ships eighteen weeks of pick data across the wire to
        // answer a question about one week. (qodo #8 on this PR.)
        //
        // It is also defence in depth on the one dangerous artifact in this
        // plan: the allowlist below already refuses to RETURN an unrevealed
        // pick, and this stops the callable from even loading one. Two
        // independent reasons a future edit would have to defeat.
        //
        // `FieldPath` rather than a dotted string, because Survivor and Margin
        // key their picks by the WEEK NUMBER — `'picks.4'` is a field path whose
        // second segment is numeric, which is exactly the shape that parses
        // wrong. The explicit segments have no such ambiguity.
        //
        // ⚠️ A wrong mask fails SILENTLY and expensively: every count comes back
        // 0, the roster reports the whole pool unpicked, and the reminder buttons
        // light up for people who have already picked. The emulator suite covers
        // both pool shapes for exactly that reason.
        const FieldPath = admin.firestore.FieldPath;
        // `entryName` rides the mask so the `entries` roster below can be built
        // from the same masked read (PLAN-MULTI-ENTRY D5) — it is a display
        // label, never pick content.
        const fields: Array<string | InstanceType<typeof FieldPath>> = ['ownerUid', 'entryName'];
        if (pool.type === 'NFL_PICKEM') {
            for (const id of weekGameIds) {
                fields.push(new FieldPath('picks', id));
                fields.push(new FieldPath('confidence', id));
            }
        } else {
            fields.push(new FieldPath('picks', String(week)));
        }
        if (reveal.weekRevealed) fields.push(new FieldPath('weeklyTiebreakers', String(week)));

        // The roster projection rides alongside the entries scan: ONE document,
        // and it is the only source of `playerUids` (D7). Not `participantIds`,
        // which a manager could historically forge into; not the `members`
        // subcollection, which is the O(roster) read this callable was made to
        // stop doing on a path every member polls.
        const [entriesSnap, summarySnap] = await Promise.all([
            db.collection('pools').doc(poolId).collection('entries')
                .select(...(fields as string[]))
                .limit(REVEAL_ENTRY_CAP + 1)
                .get(),
            rosterSummaryRef(db, poolId).get(),
        ]);
        if (entriesSnap.docs.length > REVEAL_ENTRY_CAP) {
            // Fail LOUD, never truncate: a partial scan would hand every
            // caller wrong counts/progress and quietly hide entries.
            console.error(`[getPoolPicks] pool ${poolId} exceeds REVEAL_ENTRY_CAP (${REVEAL_ENTRY_CAP}).`);
            throw new HttpsError('failed-precondition', 'ENTRY_SCAN_OVERFLOW: this pool has more entries than the reveal surface supports.');
        }

        // ⚠️ COMPUTED OFF THE RAW SNAPSHOT, OUTSIDE THE LOOP BELOW, ON PURPOSE.
        // That loop `continue`s past a departed member's entry FOR PARTICIPANTS
        // ONLY, so an accumulator inside it would hand a participant and a
        // commissioner different numbers — the exact contradiction of the
        // "identical for every principal" claim above. `playerUids` already
        // excludes departed members for every principal, so this needs none of it.
        const progress = pickProgressFor({
            playerUids: (summarySnap.data() as { playerUids?: string[] } | undefined)?.playerUids,
            poolType: pool.type,
            week,
            weekGameIds,
            entries: entriesSnap.docs.map(d => {
                const e = d.data() as { ownerUid?: string; picks?: Record<string, unknown> };
                return { ownerUid: e.ownerUid || d.id, picks: e.picks };
            }),
        });

        const counts: Record<string, number> = {};
        const picks: Record<string, Record<string, string>> = {};
        const confidence: Record<string, Record<string, number>> = {};
        const tiebreakers: Record<string, number> = {};
        const entries: Record<string, { ownerUid: string; entryName?: string }> = {};

        for (const doc of entriesSnap.docs) {
            const entry = doc.data() as {
                ownerUid?: string;
                entryName?: string;
                picks?: Record<string, unknown>;
                confidence?: Record<string, unknown>;
                weeklyTiebreakers?: Record<string, unknown>;
            };
            const memberUid = entry.ownerUid || doc.id;
            // 🛑 THE MAP KEY IS THE ENTRY, THE FILTER SUBJECT IS THE PERSON
            // (PLAN-MULTI-ENTRY D5). `memberUid` still decides departure and
            // still keys `progress`; `entryKey` is what every returned map is
            // filed under. They are the same string for entry #1, which is why
            // no existing pool changes shape.
            const entryKey = doc.id;

            // D7/K8 — skip entirely, so a departed player is absent from EVERY
            // map rather than merely from `picks`. Their presence in `counts`
            // alone would still say "this person is playing".
            if (stillAMember && !stillAMember(memberUid)) continue;

            // 🛑 `counts` IS THE ONE FIELD IN THIS RESPONSE THAT IS NOT GATED,
            // AND THAT IS NOW DELIBERATE FOR EVERY PRINCIPAL.
            //
            // Every other field is gated: `picks` and `confidence` by the
            // `allowedKeys` allowlist over `revealedGameIds`, `tiebreakers` by
            // `weekRevealed`. Those are unchanged and this comment is not a
            // licence to loosen them — NOTHING ABOUT PICK CONTENT MAY BECOME
            // MEMBER-VISIBLE.
            //
            // ⚠️ THIS REVERSES K1 (2026-08-14), ON PURPOSE.
            // K1 withheld the per-member count from participants until the week
            // revealed, on the reasoning that watching "Kevin 14 of 16" tick to
            // 15 tells you he is still working and nobody asked for that.
            // Kevin re-answered it on 2026-08-22 knowing that: a count carries
            // no content, and on a PER_GAME pool "the whole week revealed" is
            // the LAST kickoff — so a member saw `—` from Tuesday to Sunday
            // evening, which is the entire window in which the count is useful.
            // He had separately answered that the Set column is enough, and
            // that only holds if members can see it.
            // PLAN-MEMBER-SET-COLUMN.md carries the inference analysis.
            //
            // The aggregate half already shipped ungated (`progress`, from
            // `pickProgressFor`), and it already determines every individual
            // whenever it reads 0 of N or N of N. This widens the RESOLUTION of
            // participation information; it does not open a door that was shut.
            //
            // ⚠️ THE `stillAMember` FILTER ABOVE MUST KEEP RUNNING FIRST. A
            // departed player appearing in `counts` alone would still say "this
            // person is playing" (D7/K8).
            counts[entryKey] = weekPickCount(pool.type, entry.picks as Record<string, unknown>, week, weekGameIds);
            entries[entryKey] = {
                ownerUid: memberUid,
                ...(typeof entry.entryName === 'string' && entry.entryName ? { entryName: entry.entryName } : {}),
            };

            const revealedPicks: Record<string, string> = {};
            for (const key of allowedKeys) {
                const value = entry.picks?.[key];
                if (typeof value === 'string' && value) revealedPicks[key] = value;
            }
            if (Object.keys(revealedPicks).length > 0) picks[entryKey] = revealedPicks;

            const revealedConfidence: Record<string, number> = {};
            for (const key of allowedKeys) {
                const value = entry.confidence?.[key];
                if (typeof value === 'number') revealedConfidence[key] = value;
            }
            if (Object.keys(revealedConfidence).length > 0) confidence[entryKey] = revealedConfidence;

            if (reveal.weekRevealed) {
                const tb = entry.weeklyTiebreakers?.[String(week)];
                if (typeof tb === 'number') tiebreakers[entryKey] = tb;
            }
        }

        const response: PoolPicksResponse = {
            week,
            mode: reveal.mode,
            revealedGameIds: reveal.revealedGameIds,
            weekRevealed: reveal.weekRevealed,
            weekGameIds,
            counts,
            picks,
            confidence,
            tiebreakers,
            // D5 — a participant gets the entry roster only once the week has
            // revealed. Commissioner and SUPER_ADMIN always get it: chasing
            // missing picks is their job and they already see `counts`.
            ...(!isParticipant || reveal.weekRevealed ? { entries } : {}),
            progress,
        };

        // Transport bound (Phase 4): the doc-count cap alone is not
        // demonstrably transport-safe (worst legal entry ≈ 25 KB of maps).
        // UTF-8 bytes, not string length. Same loud-overflow contract.
        const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
        if (responseBytes > REVEAL_RESPONSE_BYTE_BUDGET) {
            console.error(`[getPoolPicks] pool ${poolId} response ${responseBytes}B exceeds REVEAL_RESPONSE_BYTE_BUDGET.`);
            throw new HttpsError('failed-precondition', 'ENTRY_SCAN_OVERFLOW: this pool\'s reveal response is larger than the surface supports.');
        }
        return response;
    },
);
