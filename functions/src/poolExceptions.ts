import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { writeAuditEvent } from "./audit";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";
import { User } from "./types";
import { NFLGame, SurvivorEntry, MarginEntry } from "./nflPoolTypes";
import { ADMIN_CLOSE, isTerminalStatus, adminCloseUpdate } from "./lib/lifecycle";
import { writeAdminAudit } from "./lib/adminAudit";
import { validated } from "./lib/validated";
import {
    extendWeekDeadlineSchema,
    proxyPickSchema,
    cancelPoolSchema,
    closePoolSchema,
} from "./schemas/poolExceptions";
import { usesWeeklyHardLock, normalizeLockBufferMinutes, ensureHardLockFreezeForPoolDoc } from "./lib/effectiveLock";
import { ensureMemberRecord, membersCol } from "./lib/memberRecord";
import type { MemberRecord } from "./shared/memberRecord";
import {
    assertNoScoringInProgress,
    retryWhileScoring,
    leaseIsLive,
    readScoringLease,
    readLockRevision,
} from "./lib/scoringLease";
import { nextEntryRevision, ENTRY_REVISION_FIELD } from "./lib/entryRevision";
import { countTeamUses, effectiveMaxTeamUses, UNLIMITED_TEAM_USES } from "./shared/survivorReuse";
import { extensionRefusal } from "./lib/publishedWeeks";

// Commissioner exception tools (UX overhaul Phase 3.6).
// Real seasons have exceptions — a member in the hospital, a mis-set deadline,
// a pool that needs to die. These callables give commissioners a sanctioned,
// audited path instead of routing around the app via Firestore surgery.
//
// All three: onCall + auth + assertPoolOwnerOrSuperAdmin + audit event.

const MAX_EXTRA_MINUTES = 24 * 60; // cap extensions at 24 hours

const loadPoolAndAssertManager = async (
    db: admin.firestore.Firestore,
    poolId: unknown,
    uid: string,
    role?: string
) => {
    if (!poolId || typeof poolId !== "string") {
        throw new HttpsError("invalid-argument", "poolId is required.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const pool = { id: poolSnap.id, ...poolSnap.data() } as any;
    assertPoolOwnerOrSuperAdmin(pool, uid, role);
    return { poolRef, pool };
};

/** Fetch the week's games the same way submitNFLPicks does. */
const loadWeekGames = async (
    db: admin.firestore.Firestore,
    pool: any,
    week: number
): Promise<NFLGame[]> => {
    const gamesSnap = await db.collection("nfl_games")
        .where("season", "==", pool.season)
        .where("seasonType", "==", Number(pool.seasonType || 2))
        .where("week", "==", week)
        .get();
    const games = gamesSnap.docs.map((d) => d.data() as NFLGame);
    if (games.length === 0) {
        throw new HttpsError("not-found", `No NFL games found for week ${week}.`);
    }
    return games;
};

/** Resolve unique member emails: entries ownerUid -> users/{uid}.email (same as manualReminders.ts). */
const resolveMemberEmails = async (
    db: admin.firestore.Firestore,
    poolRef: admin.firestore.DocumentReference
): Promise<string[]> => {
    const entriesSnap = await poolRef.collection("entries").get();
    const seenUids = new Set<string>();
    const emails = new Set<string>();
    for (const doc of entriesSnap.docs) {
        const targetUid = (doc.data().ownerUid as string) || doc.id;
        if (seenUids.has(targetUid)) continue;
        seenUids.add(targetUid);
        const userDoc = await db.collection("users").doc(targetUid).get();
        const email = userDoc.exists ? (userDoc.data() as User).email : undefined;
        if (email) emails.add(email);
    }
    return [...emails];
};

const formatLockTime = (epochMs: number): string => {
    return new Date(epochMs).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }) + " ET";
};

// ============ 1. EXTEND WEEK DEADLINE ============
// NFL pools compute lock from game startTimes + lockBufferMinutes, so an
// extension is a per-pool override: settings.weekLockOverrides.{week} = new
// lock time in epoch ms.
//
// KNOWN CAVEAT (schema-first): submitNFLPicks in nflPools.ts does NOT read
// weekLockOverrides yet. A follow-up change to nflPools.ts is required before
// member-facing pick submission honors extensions. proxyPick below DOES honor
// the override.
export const extendWeekDeadline = validated(
    // Shape (week 1-23, extraMinutes <= 24h cap, 3-200 char reason) enforced by
    // the wrapper; permission stays resource-scoped (loadPoolAndAssertManager).
    { schema: extendWeekDeadlineSchema, label: "extendWeekDeadline", appCheck: "monitor" },
    async (input, request) => {
    const uid = request.auth!.uid;
    const db = admin.firestore();
    const { poolId, week: weekNum, extraMinutes: extraMin, reason } = input;

    const { poolRef, pool } = await loadPoolAndAssertManager(db, poolId, uid, request.auth!.token.role as string | undefined);

    // Survivor/Margin run a HARD weekly deadline before the first kickoff (Kevin's
    // ruling 2026-07-25). An extension there could push the deadline past a game
    // that has already been played, so the pick could be changed with the result
    // known — and those are the pool types scored live game-by-game. The deadline is
    // set once, via the lock-buffer preset. Refused outright rather than clamped, so
    // the commissioner gets a clear answer instead of a silently ignored extension.
    if (usesWeeklyHardLock(pool.type)) {
        throw new HttpsError(
            "failed-precondition",
            "HARD_WEEKLY_LOCK: Survivor and Margin pools use a fixed weekly deadline before the first kickoff, so a week cannot be reopened once it locks. The Pick Deadline setting controls how early picks close for weeks that have not locked yet.",
        );
    }

    const games = await loadWeekGames(db, pool, weekNum);
    const lockBufferMs = (pool.settings?.lockBufferMinutes ?? 5) * 60 * 1000;
    const earliestGameTime = Math.min(...games.map((g) => g.startTime));
    const baseLockTime = earliestGameTime - lockBufferMs;
    const newLockTime = baseLockTime + extraMin * 60000;

    // The publish guard + the lock-revision bump, in ONE transaction with the
    // override write (PLAN-REALTIME-SCORING §3a, codex r6/r7).
    //
    // A plain read-then-write races the scorer in both directions:
    //  - read the marker unset, and the scorer publishes the first result in the
    //    same instant → an extension accepted AFTER the outcome was exposed;
    //  - check, then let the scorer's chunked entry batches start, then commit →
    //    the pass writes grades computed against the pre-extension deadline.
    // Serializing the marker read with the write closes the first. The second
    // needs the LEASE (refuse while a pass owns the pool) plus `lockRevision`,
    // which every fenced write of that pass re-asserts — so a pass that was
    // already in flight discards its remaining writes instead of landing them.
    await retryWhileScoring(() => db.runTransaction(async (tx) => {
        const snap = await tx.get(poolRef);
        const current = snap.data() as Record<string, unknown> | undefined;

        const refusal = extensionRefusal(
            current, weekNum, leaseIsLive(readScoringLease(current), Date.now()),
        );
        if (refusal === 'WEEK_ALREADY_PUBLISHED') {
            throw new HttpsError(
                "failed-precondition",
                `WEEK_ALREADY_PUBLISHED: Week ${weekNum}'s results have already been shown to members, so its deadline can no longer be extended.`,
            );
        }
        if (refusal === 'SCORING_IN_PROGRESS') {
            throw new HttpsError(
                "aborted",
                "SCORING_IN_PROGRESS: this week is being scored right now. Try again in a moment.",
            );
        }

        tx.update(poolRef, {
            [`settings.weekLockOverrides.${weekNum}`]: newLockTime,
            // Monotonic, and the backstop the scorer re-asserts at every fenced
            // write: an override that lands between a pass's lease acquisition
            // and its next commit invalidates that pass.
            'settings.lockRevision': readLockRevision(current) + 1,
        });
    }));

    await writeAuditEvent({
        poolId: pool.id,
        type: "DEADLINE_EXTENDED",
        message: `Commissioner extended Week ${weekNum} deadline by ${extraMin} minutes (new lock: ${formatLockTime(newLockTime)}). Reason: ${reason}`,
        severity: "WARNING",
        actor: { uid, role: "ADMIN", label: "Commissioner" },
        payload: { week: weekNum, extraMinutes: extraMin, baseLockTime, newLockTime, reason },
    });

    // Email all members
    const poolName = pool.name || "Your pool";
    const subject = `Deadline extended: ${poolName} Week ${weekNum}`;
    const body = `
        <p>Hi,</p>
        <p>The commissioner has extended the Week ${weekNum} pick deadline for <strong>${escapeHtml(poolName)}</strong>.</p>
        <p><strong>New deadline:</strong> ${escapeHtml(formatLockTime(newLockTime))}</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
    `;
    const html = renderEmailHtml("Deadline Extended", body, `${BASE_URL}/pool/${pool.id}`, "Open Pool");
    const emails = await resolveMemberEmails(db, poolRef);
    let emailed = 0;
    for (const email of emails) {
        await sendEmail(db, email, subject, html, { poolId: pool.id, reason: "deadline_extended" });
        emailed++;
    }

    return { success: true, newLockTime, emailed };
    },
);

// ============ 2. PROXY PICK ============
// Commissioner enters picks on behalf of a member (e.g. member in hospital).
// Mirrors submitNFLPicks validation minimally per pool type; respects real
// deadlines UNLESS the week has a settings.weekLockOverrides entry.
// Writes proxySubmittedBy + proxyReason onto the entry so standings stay honest.
export const proxyPick = validated(
    // Shape enforced by the wrapper (also replaces the old JSON round-trip
    // sanitization — zod parse returns plain data). Per-pick game/team/lock
    // validation stays in the transaction below.
    { schema: proxyPickSchema, label: "proxyPick", appCheck: "monitor" },
    async (input, request) => {
    const uid = request.auth!.uid;
    const db = admin.firestore();
    const { poolId, week: weekNum, targetUid, picks, reason } = input;

    const { poolRef, pool } = await loadPoolAndAssertManager(db, poolId, uid, request.auth!.token.role as string | undefined);
    const type = pool.type;
    if (type !== "NFL_PICKEM" && type !== "NFL_SURVIVOR" && type !== "NFL_MARGIN") {
        throw new HttpsError("failed-precondition", "Proxy picks are only supported for NFL pools.");
    }

    // Target must be a pool member (participant or existing entry).
    const entryRef = poolRef.collection("entries").doc(targetUid);
    const isParticipant = Array.isArray(pool.participantIds) && pool.participantIds.includes(targetUid);
    const preEntrySnap = await entryRef.get();
    if (!isParticipant && !preEntrySnap.exists) {
        throw new HttpsError("failed-precondition", "Target user is not a member of this pool.");
    }

    const games = await loadWeekGames(db, pool, weekNum);
    // MUTABLE, refreshed at the top of every transaction attempt below — the
    // scoring lease can bounce this call and `retryWhileScoring` re-runs the
    // transaction up to a second later. A clock captured once out here would keep
    // re-asserting a deadline that has since passed (codex r1).
    let now = Date.now();
    // Hard-lock types (Survivor/Margin) snap the buffer to an allowed preset and
    // ignore overrides entirely — see effectiveLock.effectiveLockSettings.
    const hardLock = usesWeeklyHardLock(type);
    const lockBufferMs = (hardLock
        ? normalizeLockBufferMinutes(pool.settings?.lockBufferMinutes)
        : (pool.settings?.lockBufferMinutes ?? 5)) * 60 * 1000;
    const earliestGameTime = Math.min(...games.map((g) => g.startTime));

    // Deadline override: if the commissioner extended this week, locks are
    // measured against the override instead of kickoff - buffer. NEVER for
    // hard-lock pools: an override there could push the deadline past a kickoff
    // that already happened, letting a proxy pick land on a known result.
    const rawOverride = hardLock ? undefined : (pool.settings?.weekLockOverrides?.[weekNum]
        ?? pool.settings?.weekLockOverrides?.[String(weekNum)]);
    const override = typeof rawOverride === "number" ? rawOverride : undefined;

    // Hard-lock pools also honor the frozen (earliest-ever) deadline, or a proxy
    // pick would slip through the same reopen that regular submissions now refuse.
    // Established transactionally BEFORE the checks, exactly as submitNFLPicks does —
    // a week with no freeze yet (nobody submitted, reminders off) would otherwise be
    // reopenable by widening the buffer and then proxying a pick.
    const computedWeekLock = override ?? (earliestGameTime - lockBufferMs);
    const weekLockAt = hardLock
        ? ((await ensureHardLockFreezeForPoolDoc(
            poolRef as never,
            db.runTransaction.bind(db) as never,
            pool as { type?: string; settings?: { lockBufferMinutes?: number }; hardLockByWeek?: Record<string, unknown> },
            weekNum,
            games.map((g) => g.startTime),
          )) ?? computedWeekLock)
        : computedWeekLock;
    // `weekLockAt` and `gameLockAt` are fixed instants; only the clock moves.
    let weekLocked = now >= weekLockAt;
    const gameLockAt = (g: NFLGame) => override ?? (g.startTime - lockBufferMs);

    // Resolve display name for entry creation
    const targetUserDoc = await db.collection("users").doc(targetUid).get();
    const targetName = targetUserDoc.exists ? ((targetUserDoc.data() as User).name || "Participant") : "Participant";

    await retryWhileScoring(() => db.runTransaction(async (transaction) => {
        // Entry mutators participate in the scoring mutex — a commissioner proxy
        // pick landing mid-pass is the same interleave as a member submission
        // (PLAN-REALTIME-SCORING §3a). Read first: Firestore requires it, and it
        // puts the pool doc in this transaction's read set.
        // Fresh clock per ATTEMPT — this body re-runs on a Firestore contention
        // retry and on a lease-busy retry, and every lock check below reads `now`.
        now = Date.now();
        weekLocked = now >= weekLockAt;
        await assertNoScoringInProgress(transaction, poolRef, now);
        const entrySnap = await transaction.get(entryRef);
        const existingEntry = entrySnap.exists ? entrySnap.data() : null;
        // Read the Member Record HERE, with the other reads: Firestore forbids a
        // read after a write in a transaction, and this one exists to advance the
        // playable-entry latch below.
        const memberSnap = await transaction.get(membersCol(db, pool.id).doc(targetUid));
        const existingMember = memberSnap.exists ? (memberSnap.data() as MemberRecord) : null;
        // Did this call actually commit a selection? Only then may the latch move.
        let committedPick = false;

        if (type === "NFL_PICKEM") {
            const settings = pool.settings || {};
            const weeklyLockMode = settings.confidenceMode || settings.lockMode === "WEEKLY";

            // Validate each pick: game must exist this week, team must be playing in it.
            for (const [gameId, pickedTeam] of Object.entries(picks as Record<string, string>)) {
                const game = games.find((g) => g.id === gameId);
                if (!game) {
                    throw new HttpsError("invalid-argument", `Game ${gameId} not found in week ${weekNum}.`);
                }
                if (pickedTeam !== game.homeTeam.abbreviation && pickedTeam !== game.awayTeam.abbreviation) {
                    throw new HttpsError("invalid-argument", `${pickedTeam} is not playing in game ${gameId}.`);
                }
                if (weeklyLockMode) {
                    if (weekLocked) {
                        throw new HttpsError("failed-precondition", "WEEK_LOCKED: This week is locked. Extend the deadline first if an exception is warranted.");
                    }
                } else {
                    const isGameLocked = now >= gameLockAt(game);
                    const oldPick = existingEntry?.picks?.[gameId];
                    if (isGameLocked && oldPick !== pickedTeam) {
                        throw new HttpsError("failed-precondition", `GAME_LOCKED: Game ${gameId} is locked. Extend the deadline first if an exception is warranted.`);
                    }
                }
            }

            // codex r4: `proxyPickSchema`'s `picks` is a bare `z.record()` with only
            // a max-50 refinement, so `picks: {}` is ACCEPTED and the validation
            // loop above iterates nothing. Without this the latch would advance on
            // a call that committed no selection at all — and for a seeded manager
            // that also upgrades `feeOwed` from 0 to the entry fee, charging them
            // for a pick nobody made. Narrowed here rather than by tightening the
            // schema: rejecting empty payloads changes this callable's contract for
            // every existing caller, which is a bigger blast radius than the bug.
            committedPick = Object.keys(picks as Record<string, string>).length > 0;

            transaction.set(entryRef, {
                id: targetUid,
                poolId: pool.id,
                ownerUid: targetUid,
                userName: existingEntry?.userName || targetName,
                picks: { ...(existingEntry?.picks || {}), ...picks },
                totalScore: existingEntry?.totalScore ?? 0,
                submittedAt: now,
                paidStatus: existingEntry?.paidStatus ?? "UNPAID",
                proxySubmittedBy: uid,
                proxyReason: reason,
                // Per-entry watermark: a late proxy pick must move the scorer's
                // fingerprint or it is graded on the next pass that happens to
                // change for some other reason — possibly never.
                [ENTRY_REVISION_FIELD]: nextEntryRevision((existingEntry as any)?.[ENTRY_REVISION_FIELD]),
            }, { merge: true });

        } else {
            // NFL_SURVIVOR / NFL_MARGIN: single team keyed by week
            const teamPicked = (picks as Record<string, string>)[weekNum] ?? (picks as Record<string, string>)[String(weekNum)];
            if (!teamPicked || typeof teamPicked !== "string") {
                throw new HttpsError("invalid-argument", `Missing team selection for week ${weekNum} (picks must be keyed by week).`);
            }

            const entry: any = existingEntry || (type === "NFL_SURVIVOR"
                ? {
                    id: targetUid, poolId: pool.id, ownerUid: targetUid, userName: targetName,
                    status: "ALIVE", strikesUsed: 0, rebuysUsed: 0, usedTeams: [], picks: {},
                    exemptWeeks: [], submittedAt: now, paidStatus: "UNPAID",
                } as SurvivorEntry
                : {
                    id: targetUid, poolId: pool.id, ownerUid: targetUid, userName: targetName,
                    picks: {}, usedTeams: [], weeklyScores: {}, seasonTotal: 0,
                    negativeBurden: 0, positiveWeeks: 0, bestWeek: 0, submittedAt: now, paidStatus: "UNPAID",
                } as MarginEntry);

            if (type === "NFL_SURVIVOR" && entry.status === "ELIMINATED") {
                throw new HttpsError("failed-precondition", "ELIMINATED: Eliminated players cannot receive proxy picks.");
            }

            const oldPick = entry.picks?.[weekNum];
            const usedTeams: string[] = entry.usedTeams || [];

            // Reject teams already used this season (excluding this week's current pick).
            //
            // TRI-MODE, and it must MATCH `submitNFLPicks` exactly: a
            // commissioner proxy pick that rejected a reuse the member could
            // submit themselves would be a third opinion about what "used"
            // means, which is the class of bug PR #384 was. Survivor only —
            // Margin keeps one use per team per season (out of scope).
            const maxTeamUses = type === "NFL_SURVIVOR"
                ? effectiveMaxTeamUses(pool.settings)
                : 1;
            if (maxTeamUses === 1) {
                if (teamPicked !== oldPick && usedTeams.includes(teamPicked)) {
                    throw new HttpsError("invalid-argument", `TEAM_ALREADY_USED: ${targetName} has already used the ${teamPicked} this season.`);
                }
            } else if (maxTeamUses !== UNLIMITED_TEAM_USES) {
                const uses = countTeamUses(entry.picks, weekNum)[teamPicked] ?? 0;
                if (uses >= maxTeamUses) {
                    throw new HttpsError(
                        "invalid-argument",
                        `TEAM_ALREADY_USED: ${targetName} has already used the ${teamPicked} ${maxTeamUses} time${maxTeamUses === 1 ? "" : "s"} this season.`,
                    );
                }
            }

            // Team must actually be playing this week.
            const game = games.find((g) => g.homeTeam.abbreviation === teamPicked || g.awayTeam.abbreviation === teamPicked);
            if (!game) {
                throw new HttpsError("invalid-argument", `TEAM_NOT_PLAYING: The ${teamPicked} are not playing in week ${weekNum}.`);
            }

            // Lock checks (respecting the override — which hardLock types never have).
            // Weekly lock is derived from the pool TYPE for Survivor/Margin so a
            // settings write cannot downgrade it to per-game.
            const isWeeklyLock = hardLock || pool.settings?.lockMode === "WEEKLY";
            if (isWeeklyLock && weekLocked) {
                throw new HttpsError("failed-precondition", "WEEK_LOCKED: This week is locked. Extend the deadline first if an exception is warranted.");
            }
            const isGameLocked = now >= gameLockAt(game);
            if (!isWeeklyLock && isGameLocked && oldPick !== teamPicked) {
                throw new HttpsError("failed-precondition", `GAME_LOCKED: The game for ${teamPicked} has already locked. Extend the deadline first if an exception is warranted.`);
            }

            // Survivor/Margin cannot reach here without a team: the guard above
            // throws on a missing selection.
            committedPick = true;

            // Ledger rewrite, twin of the submit path. Remove-then-re-add
            // assumes one use per team and would strip a team still held by
            // another week, so under reuse derive it from the resulting picks.
            const nextPicks = { ...(entry.picks || {}), [weekNum]: teamPicked };
            const oldUsed = usedTeams.filter((t: string) => t !== oldPick);
            transaction.set(entryRef, {
                ...entry,
                picks: nextPicks,
                usedTeams: maxTeamUses === 1
                    ? [...new Set([...oldUsed, teamPicked])]
                    : [...new Set(Object.values(nextPicks) as string[])],
                submittedAt: now,
                proxySubmittedBy: uid,
                proxyReason: reason,
                [ENTRY_REVISION_FIELD]: nextEntryRevision((existingEntry as any)?.[ENTRY_REVISION_FIELD]),
            }, { merge: true });
        }

        // A proxy pick IS a committed entry, so it must advance the playable-entry
        // latch — this callable writes entries/{uid} directly and, before
        // 2026-07-31, never touched the Member Record at all. Found by codex
        // reviewing the change that first persisted that latch: without this, a
        // member whose only entry arrived by proxy would be recorded as never
        // having entered, and would also keep a MANAGER's dues at 0 forever.
        //
        // Placed after both branches so it covers PICKEM and SURVIVOR/MARGIN, and
        // only on the success path — every failure above throws out of the
        // transaction before reaching here.
        //
        // ⚠️ ONLY UPDATES AN EXISTING RECORD — it must never CREATE one. codex r3
        // caught the first version doing so: `planMembershipWrite`'s create branch
        // seeds `paidStatus: 'UNPAID'`, and this callable has no payment context to
        // seed it correctly. On a legacy member with a PAID entry and no Member
        // Record, that minted an UNPAID record which `buildPoolRoster` then PREFERS
        // over the entry — silently marking a paid member unpaid and adding their
        // fee back to outstanding dues. Advancing a latch must not be able to move
        // money. Creating the record stays with the join/submit paths that know.
        if (existingMember && committedPick) ensureMemberRecord(transaction, db, pool.id, targetUid, {
            userName: existingMember?.userName || existingEntry?.userName as string || targetName,
            role: existingMember?.role ?? (pool.ownerId === targetUid ? 'MANAGER' : 'PARTICIPANT'),
            poolType: type,
            present: true,
            entryFee: Number(pool.settings?.entryFee ?? 0),
            hasPlayableEntry: true,
            // Pick marker (PLAN-COMMISSIONER-BLIND-PICKS T1). Without it a
            // proxy-picked member's own standings cell reads "No selection" for
            // a pick that exists. The `existingMember &&` guard above still
            // holds: a member with NO record gets no marker and no record, which
            // is the money-safety behaviour, not an oversight.
            pickedWeek: weekNum,
        }, existingMember, now);
    }));

    await writeAuditEvent({
        poolId: pool.id,
        type: "PROXY_PICK_SUBMITTED",
        message: `Commissioner submitted Week ${weekNum} picks on behalf of ${targetName} (${targetUid}). Reason: ${reason}`,
        severity: "WARNING",
        actor: { uid, role: "ADMIN", label: "Commissioner" },
        payload: { targetUid, week: weekNum, picks, reason },
    });

    return { success: true };
    },
);

// ============ 3. CANCEL POOL ============
// Kills a dead pool cleanly: status -> CANCELED, audit trail, member email
// including who to contact about dues already paid.
export const cancelPool = validated(
    { schema: cancelPoolSchema, label: "cancelPool", appCheck: "monitor" },
    async (input, request) => {
    const uid = request.auth!.uid;
    const db = admin.firestore();
    const { poolId, reason } = input;

    const { poolRef, pool } = await loadPoolAndAssertManager(db, poolId, uid, request.auth!.token.role as string | undefined);

    if (pool.status === "CANCELED") {
        throw new HttpsError("failed-precondition", "This pool has already been canceled.");
    }

    const now = Date.now();
    await poolRef.update({
        status: "CANCELED",
        cancelledAt: now,
        cancelReason: reason,
    });

    await writeAuditEvent({
        poolId: pool.id,
        type: "POOL_CANCELED",
        message: `Pool "${pool.name}" was canceled by the commissioner. Reason: ${reason}`,
        severity: "CRITICAL",
        actor: { uid, role: "ADMIN", label: "Commissioner" },
        payload: { reason, previousStatus: pool.status ?? null },
    });

    // Email all members
    const poolName = pool.name || "Your pool";
    const managerName = pool.managerName || "the pool commissioner";
    const subject = `${poolName} has been canceled by the commissioner`;
    const body = `
        <p>Hi,</p>
        <p><strong>${escapeHtml(poolName)}</strong> has been canceled by the commissioner.</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        <p>Contact ${escapeHtml(managerName)} about any dues already paid.</p>
    `;
    const html = renderEmailHtml("Pool Canceled", body);
    const emails = await resolveMemberEmails(db, poolRef);
    let emailed = 0;
    for (const email of emails) {
        await sendEmail(db, email, subject, html, { poolId: pool.id, reason: "pool_canceled" });
        emailed++;
    }

    return { success: true, emailed };
    },
);

// closePool (T2) — settles a pool into its terminal COMPLETED state. Unlike
// cancelPool (which voids a dead pool + emails members), this is the normal
// "the contest is over" close: it dual-writes the canonical status AND the
// legacy fields non-admin screens read (isLocked/isFinal/scores.gameStatus:'post')
// so the pool leaves every open/live surface, plus closedVia:'ADMIN_CLOSE' — the
// flag that makes onPoolLocked / onGameComplete / recalculateGlobalStats skip it,
// so an admin close produces ZERO member emails and ZERO stats deltas.
// Principal: ownerId || managerUid || SUPER_ADMIN (loadPoolAndAssertManager).
export const closePool = validated(
    { schema: closePoolSchema, label: "closePool", appCheck: "monitor" },
    async (input, request) => {
    const uid = request.auth!.uid;
    const db = admin.firestore();
    const { poolId } = input;

    const { poolRef, pool } = await loadPoolAndAssertManager(db, poolId, uid, request.auth!.token.role as string | undefined);

    // CANCELED (and an already-COMPLETED close) are terminal — never overwrite.
    if (isTerminalStatus(pool.status as string | undefined)) {
        throw new HttpsError("failed-precondition", `This pool is already ${pool.status} and cannot be closed.`);
    }

    const now = Date.now();
    await poolRef.update(adminCloseUpdate(now));

    await writeAuditEvent({
        poolId: pool.id,
        type: "POOL_CLOSED",
        message: `Pool "${pool.name}" was closed (COMPLETED) by an admin.`,
        severity: "WARNING",
        actor: { uid, role: "ADMIN", label: "Admin" },
        payload: { previousStatus: pool.status ?? null, closedVia: ADMIN_CLOSE },
    });

    await writeAdminAudit({
        actorUid: uid,
        actorEmail: request.auth!.token.email as string | undefined,
        action: "POOL_CLOSED",
        targetType: "pool",
        targetId: pool.id,
        metadata: { name: pool.name, previousStatus: pool.status ?? null },
        status: "success",
    });

    return { success: true };
    },
);
