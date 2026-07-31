import * as admin from 'firebase-admin';
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from 'firebase-functions/v2/https';
import { writeAuditEvent, type AuditOptions } from "./audit";
import { checkBillingAccess } from "./billing";
import { writeLedgerEvent } from "./paymentLedger";
import { assertPoolOwnerOrSuperAdmin, stripPrivilegedPoolFields, computeLaunchMode, assertPaidParticipantCeiling, simRunIdForCreate, assertSeasonNotForgedSim } from "./poolOps";
import { loadBillingConfig } from "./billing";
import { assertPoolCreationAllowed, assertNotMaintenance, assertNotBannedLive } from "./lib/systemGuards";
import { isPoolType, type PoolType } from "./shared/poolTypes";
import { ensureMemberRecord, membersCol } from "./lib/memberRecord";
import type { MemberRecord } from "./shared/memberRecord";
import { effectiveWeekLockAt, isGameLocked as isGameLockedAt, effectiveLockSettings, usesWeeklyHardLock, weekLockDecision, ensureHardLockFreeze } from "./lib/effectiveLock";
import { isTerminalGame, isWeekComplete } from "./lib/weekCompletion";
import {
  validateCreateInput,
  assertNotBanned,
  billingForLaunch,
  writePoolCreationSideEffects,
} from "./lib/poolCreation";
import {
  NFLGame,
  NFLPickemPool,
  NFLSurvivorPool,
  NFLMarginPool,
  NFLPickemEntry,
  SurvivorEntry,
  MarginEntry,
} from './nflPoolTypes';
import {
  scorePickemEntry,
  validateConfidenceValues,
  computeSurvivorWeekUpdate,
  computeMNFTiebreakerTotal,
  buildWeeklyRecap,
  scoreMarginWeek,
  sortMarginLeaderboard,
  gradePickemGames,
  gradeSurvivorWeekGame,
  gradeMarginWeekGame,
  buildStandingsRows,
  poolUsesSpreads
} from './nflScoringEngine';
import { maybeFinalizeNFLPool } from './nflFinalize';
import {
  acquireScoringLease,
  releaseScoringLease,
  fencedWrite,
  assertNoScoringInProgress,
  retryWhileScoring,
  type ScoringFence,
} from './lib/scoringLease';
import { nextEntryRevision, ENTRY_REVISION_FIELD } from './lib/entryRevision';
import { isVoidedPool } from './lib/autoScoreDecisions';
import { fetchNFLWeekSchedule } from './nflSchedule';
import { recomputeWeekConsensus } from './consensus';
import { validated } from "./lib/validated";
import { createPoolPermissiveSchema, submitNFLPicksSchema } from "./schemas/poolCore";
import { joinNFLPoolSchema, executeSurvivorRebuySchema, scoreNFLWeekSchema } from "./schemas/nflPools";

/**
 * Creates an NFL pool (Pick'em, Survivor, or Margin).
 */
export const createNFLPool = validated(
  // TARGET-NOW-PERMISSIVE (ADR-0001): see createPool. Field-level work stays
  // with stripPrivilegedPoolFields + validateCreateInput below.
  { schema: createPoolPermissiveSchema, label: "createNFLPool", appCheck: "monitor" },
  async (input, request) => {
  try {
    const uid = request.auth!.uid;
    const db = admin.firestore();

    // deep clean raw data + strip privileged/server-controlled fields
    const data = stripPrivilegedPoolFields(JSON.parse(JSON.stringify(input)));

    const { type, name, season } = data;
    if (!type || !['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].includes(type)) {
      throw new HttpsError('invalid-argument', 'Invalid or missing pool type.');
    }
    // Feature-flag + maintenance guard (server-authoritative).
    await assertPoolCreationAllowed(type);
    if (!name || !season) {
      throw new HttpsError('invalid-argument', 'Missing required fields: name, season.');
    }

    // Shared validation gate + ban check (poolType already narrowed above).
    const poolType: PoolType = isPoolType(type) ? type : 'NFL_PICKEM';
    validateCreateInput(poolType, data);
    const claimRole = request.auth!.token.role as string | undefined;
    assertNotBanned(claimRole, undefined);

    const poolRef = db.collection('pools').doc();
    const poolId = poolRef.id;
    const now = Date.now();

    // Launch billing mode (NOTES-WAVE2 A1): NFL create payloads carry no per-pool
    // player cap, so with no paid add-on this resolves to 'free' (unchanged
    // behavior); a selected paid add-on forces 'trial'. Config read fails open.
    const billingConfig = await loadBillingConfig(db);
    const launchMode = computeLaunchMode(data, billingConfig.freePlayerThreshold);

    const newPool: any = {
      ...data,
      // Season is persisted as a STRING, always. nfl_games.season is written as
      // a string by the importer, and Firestore equality is type-sensitive — so
      // a pool created with `season: 2026` (the create envelope is permissive
      // and passes the payload through) matches no games at all: every member's
      // pick submission throws NOT_FOUND, manual scoring finds no slate, and the
      // scheduled scorer's candidate query never returns it. Coercing here fixes
      // all of those at once, which querying both representations per call site
      // would not.
      season: String(season),
      id: poolId,
      createdByUid: uid,
      ownerId: uid,
      managerUid: uid,
      createdAt: now,
      updatedAt: now,
      status: 'OPEN',
      isLocked: false,
      participantIds: [uid],
      // free or trial per server-computed launch mode (server-authoritative)
      billing: billingForLaunch(launchMode, billingConfig.trialDays, now),
    };

    // Sim harness trust anchor (stripped from clients; SUPER_ADMIN-only stamp).
    const simRunId = simRunIdForCreate((request.data || {}) as Record<string, any>, claimRole);
    if (simRunId) newPool.simRunId = simRunId;
    assertSeasonNotForgedSim(newPool.season, simRunId);

    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User profile not found.');
      }

      const currentRole = userDoc.data()?.role as string | undefined;
      assertNotBanned(claimRole, currentRole);

      transaction.set(poolRef, newPool);

      // managedPools + participations + POOL_CREATED activity + role upgrade
      writePoolCreationSideEffects(transaction, {
        uid,
        poolId,
        poolName: newPool.name,
        poolType,
        nowMs: now,
        currentRole,
      });

      // Seed the owner's Member Record so the commissioner is on the roster from t=0
      // (ADR 0003). Brand-new pool -> no existing record.
      ensureMemberRecord(transaction, db, poolId, uid,
        {
          userName: userDoc.data()?.name || request.auth?.token?.name || 'Host', role: 'MANAGER', poolType, present: true,
          // Hosting is not playing: owner feeOwed stays 0 until they submit an entry (ADR 0005).
          entryFee: Number(newPool.settings?.entryFee ?? 0), hasPlayableEntry: false,
        },
        null, now);
    });

    // Log creation to audit trail
    await writeAuditEvent({
      poolId: poolId,
      type: 'POOL_CREATED',
      message: `NFL Pool "${name}" (${type}) created by manager ${uid}`,
      severity: 'INFO',
      actor: { uid, role: 'ADMIN', label: 'Host' },
      payload: { name, type, season }
    });

    return { success: true, poolId };
  } catch (error: any) {
    console.error("createNFLPool Failure:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', `Failed to create pool: ${error.message || 'Unknown error'}`, error);
  }
  },
);

/**
 * Join an NFL Pool using a shared invite link.
 */
/**
 * Explicit member-action subject context (ADR 0006 / PLAN-NFL-SIM-HARNESS Phase 2.17).
 * Public callables pass actor === subject from request.auth; the sim harness passes
 * the SUPER_ADMIN actor plus a simulated subject — with actorRole left undefined so
 * role-based bypasses stay OFF and every gate is enforced against the subject.
 */
export interface MemberActionContext {
  actorUid: string;
  actorRole?: string;
  subjectUid: string;
  subjectName?: string;
  requestId?: string;
}

/**
 * Join flow, extracted verbatim from the joinNFLPool callable (auth/maintenance
 * checks stay in the wrapper — they are auth-plane concerns). Enrolls the SUBJECT:
 * participantIds, participation doc, Member Record, join audit event.
 */
export async function joinNFLPoolInternal(
  db: admin.firestore.Firestore,
  ctx: { subjectUid: string; subjectName?: string },
  poolId: string,
): Promise<{ success: true }> {
  const uid = ctx.subjectUid;

  if (!poolId) {
    throw new HttpsError('invalid-argument', 'poolId is required.');
  }

  const poolRef = db.collection('pools').doc(poolId);
  const userRef = db.collection('users').doc(uid);

  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) {
    throw new HttpsError('not-found', `Pool ${poolId} not found.`);
  }

  const pool = poolSnap.data() as any;
  const joinerName = ctx.subjectName || (await userRef.get()).data()?.name || 'Member';

  await db.runTransaction(async (transaction) => {
    const poolDoc = await transaction.get(poolRef);
    // Member Record read (before any writes) so we can seed it without clobbering paid state.
    const memberSnap = await transaction.get(membersCol(db, poolId).doc(uid));
    const poolData = poolDoc.data();
    if (!poolData) throw new HttpsError('not-found', 'Pool data not found');

    const participantIds = poolData.participantIds || [];
    if (participantIds.includes(uid)) {
      // Already a participant — still ensure a Member Record exists (backfill-on-touch).
      ensureMemberRecord(transaction, db, poolId, uid,
        {
          userName: joinerName, role: 'PARTICIPANT', poolType: poolData.type, present: true,
          entryFee: Number(poolData.settings?.entryFee ?? 0),
        },
        memberSnap.exists ? (memberSnap.data() as MemberRecord) : null, Date.now());
      return;
    }

    const billingStatus = poolData.billing?.status ?? 'free';
    if (billingStatus === 'free' && participantIds.length >= 10) {
      throw new HttpsError('failed-precondition', 'This pool is on the Free Plan and has reached the limit of 10 participants. The pool manager must upgrade to premium to allow more participants to join.');
    }
    // Paid-ceiling gate (NOTES-WAVE2 A2, PLAN 6b(iii)): a PAID pool cannot exceed
    // its purchased participant ceiling. No-op for free/trial pools.
    assertPaidParticipantCeiling(poolData.billing, participantIds.length);

    // 1. Add participant to pool collection
    transaction.update(poolRef, {
      participantIds: FieldValue.arrayUnion(uid)
    });

    // 2. Add participation to user profile
    transaction.set(userRef.collection('participations').doc(poolId), {
      poolId,
      joinedAt: Date.now(),
      name: poolData.name,
      type: poolData.type,
      role: 'PARTICIPANT'
    });

    // 3. Seed the Member Record (roster + payment truth, ADR 0003) — additive.
    // feeOwed stamped at join: dues are owed from membership, not from playing (ADR 0005).
    ensureMemberRecord(transaction, db, poolId, uid,
      {
        userName: joinerName, role: 'PARTICIPANT', poolType: poolData.type, present: true,
        entryFee: Number(poolData.settings?.entryFee ?? 0),
        // hasPlayableEntry is deliberately OMITTED. An earlier version of this
        // stamped `false` here on the reasoning that a brand-new joiner has no
        // entry — but codex pointed out this branch is selected only because the
        // uid is absent from `participantIds`, which is NOT the same as being new.
        // A legacy entry-only user rejoining lands here, and because the latch is
        // one-way, a durable `false` for them could never be corrected by any
        // later non-submit touch. Omitting it preserves the documented UNKNOWN.
      },
      memberSnap.exists ? (memberSnap.data() as MemberRecord) : null, Date.now());
  });

  await writeAuditEvent({
    poolId,
    type: 'POOL_STATUS_CHANGED',
    message: `User ${uid} joined NFL Pool "${pool.name}"`,
    severity: 'INFO',
    actor: { uid, role: 'USER', label: 'Participant' }
  });

  return { success: true };
}

export const joinNFLPool = validated(
  { schema: joinNFLPoolSchema, label: "joinNFLPool", appCheck: "monitor" },
  async ({ poolId }, request) => {
    await assertNotMaintenance();
    return joinNFLPoolInternal(
      admin.firestore(),
      { subjectUid: request.auth!.uid, subjectName: (request.auth!.token as { name?: string })?.name },
      poolId,
    );
  },
);

/**
 * Membership gate for pick submission (PLAN-TEST-SUITE item 11). joinNFLPool is
 * a separate callable, and before this check submitNFLPicks accepted picks from
 * ANY authenticated user — writing an entry doc keyed by their uid into a pool
 * they never joined. Pure and exported for unit tests.
 */
export function assertNFLPickMembership(
  pool: { participantIds?: unknown; ownerId?: string; managerUid?: string; createdByUid?: string },
  uid: string,
  tokenRole?: string,
): void {
  const isMember = Array.isArray(pool.participantIds) && pool.participantIds.includes(uid);
  const isOwnerOrManager = pool.ownerId === uid || pool.managerUid === uid || pool.createdByUid === uid;
  if (!isMember && !isOwnerOrManager && tokenRole !== 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'NOT_POOL_MEMBER: Join this pool before submitting picks.');
  }
}

/**
 * Pick submission, extracted verbatim from the submitNFLPicks callable (auth +
 * ban checks stay in the wrapper). Every gate — membership, spreads, effective
 * locks, used-teams, idempotency — is enforced against ctx.subjectUid; the
 * SUPER_ADMIN membership bypass keys off ctx.actorRole, which the sim harness
 * deliberately leaves undefined (ADR 0006).
 */
export async function submitNFLPicksInternal(
  db: admin.firestore.Firestore,
  ctx: MemberActionContext,
  payload: { poolId?: string; week?: number; picks?: any; confidence?: any; tiebreakerPrediction?: number },
): Promise<{ success: true }> {
  const uid = ctx.subjectUid;
  // deep clean input
  const data = JSON.parse(JSON.stringify(payload || {}));
  const { poolId, week, picks, confidence, tiebreakerPrediction } = data;
  const requestId = ctx.requestId;

  if (!poolId || !week || !picks) {
    throw new HttpsError('invalid-argument', 'Missing poolId, week, or picks.');
  }

  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) {
    throw new HttpsError('not-found', 'Pool not found.');
  }

  const pool = poolSnap.data() as any;
  
  const billingCheck = checkBillingAccess(pool.billing);
  if (!billingCheck.allowed) {
    throw new HttpsError("failed-precondition", billingCheck.reason || "Pool is locked due to billing.");
  }

  assertNFLPickMembership(pool, uid, ctx.actorRole);

  const type = pool.type;
  // MUTABLE, and refreshed at the top of every transaction attempt below. The
  // lease can bounce a submission and `retryWhileScoring` re-runs the transaction
  // up to a second later — a clock captured once out here would keep re-asserting
  // a deadline that has since passed and commit a late pick (codex r1).
  let now = Date.now();

  // 1. Fetch weekly games from firestore to validate lock-deadlines
  const gamesSnap = await db.collection('nfl_games')
    .where('season', '==', pool.season)
    .where('seasonType', '==', Number(pool.seasonType || 2))
    .where('week', '==', week)
    .get();

  const games = gamesSnap.docs.map(doc => doc.data() as NFLGame);
  if (games.length === 0) {
    throw new HttpsError('not-found', `No NFL games found for week ${week}.`);
  }

  // 1.5 Spread Validation — ONLY for pools whose scoring consumes spreads.
  //
  // This check used to be unconditional, which meant it blocked pick submission
  // for pools that never read a spread: straight-up pick'em (the wizard's only
  // mode — it hardcodes pickMode 'STRAIGHT' and exposes no ATS control),
  // NFL_SURVIVOR, and NFL_MARGIN. A week with no betting lines therefore locked
  // out every member of every NFL pool over data none of them used. Preseason
  // made that visible — the 2026 preseason feed carries a line on 1 of 49 games
  // — but the defect was not preseason-specific.
  //
  // poolUsesSpreads lives beside the ATS branch in the scorer, so this gate
  // covers exactly the pools that need a spread to be graded correctly.
  if (poolUsesSpreads(pool)) {
    const allSpreadsLocked = games.every(g => g.spread?.locked === true);
    if (!allSpreadsLocked) {
      throw new HttpsError('failed-precondition', 'SPREADS_NOT_LOCKED: Picks cannot be submitted until all game spreads for the week are finalized and locked.');
    }
  }

  // 2. Determine lock context — single source of truth (effectiveLock helper, ADR 0004).
  // Folds in lock buffer + per-game kickoff + commissioner week override; every per-game
  // check below uses isGameLockedAt so the override is always respected.
  //
  // effectiveLockSettings applies the Survivor/Margin HARD weekly deadline: it snaps
  // the buffer to an allowed preset and drops weekLockOverrides for those types, so
  // no settings write can move their deadline to or past the first kickoff. Pick'em
  // settings pass through untouched.
  const lockSettings = effectiveLockSettings(pool.settings, type);
  // weekLockDecision also folds in the earliest-ever freeze for hard-lock pools, so
  // a commissioner cannot reopen an already-closed week by widening the buffer
  // (60 -> 5 would otherwise move the deadline 55 minutes LATER). `freezeTo` is the
  // value to persist; it is written below alongside the entry.
  const decision = weekLockDecision(
    pool as { type?: string; settings?: typeof pool.settings; hardLockByWeek?: Record<string, unknown> },
    week,
    games.map(g => g.startTime),
  );
  // Persist the freeze BEFORE enforcing the lock. If it were written only after the
  // checks passed, the first submission *after* a deadline would throw before
  // recording anything — leaving no frozen value to defend against a later buffer
  // widening, which is the reopen this exists to prevent.
  const effectiveWeekLock = decision.freezeTo !== undefined
    ? await ensureHardLockFreeze(poolRef, db.runTransaction.bind(db) as never, week, decision.lockAt)
    : decision.lockAt;
  // `effectiveWeekLock` is a fixed instant, so only the clock has to move.
  let weekLocked = now >= effectiveWeekLock;

  // Write variables inside transactions
  const entryRef = poolRef.collection('entries').doc(uid);

  await retryWhileScoring(() => db.runTransaction(async (transaction) => {
    // Reads first (Firestore requires it) and the lease read first of all: a
    // submission must not interleave with a scoring pass, and putting the pool
    // doc in this transaction's read set also makes Firestore abort us if the
    // scorer commits while we are open.
    // Fresh clock per ATTEMPT — this body re-runs on a Firestore contention retry
    // and on a lease-busy retry, and every lock check below reads `now`.
    now = Date.now();
    weekLocked = now >= effectiveWeekLock;
    await assertNoScoringInProgress(transaction, poolRef, now);
    const entrySnap = await transaction.get(entryRef);
    const existingEntry = entrySnap.exists ? entrySnap.data() : null;
    // Member Record read (before any writes) for the base-dues stamp below (ADR 0005).
    const memberSnap = await transaction.get(membersCol(db, poolId).doc(uid));
    const existingMember = memberSnap.exists ? (memberSnap.data() as MemberRecord) : null;

    // Idempotency: a retried submit (client resend after a lost response) whose
    // requestId already landed is a no-op success, not a duplicate write
    if (requestId && existingEntry?.lastRequestId === requestId) {
      return;
    }

    // --- LOCK CHECKS & POOL SPECIFIC VALIDATIONS ---

    if (type === 'NFL_PICKEM') {
      const settings = pool.settings;
      const weeklyLockMode = settings.confidenceMode || settings.lockMode === 'WEEKLY';

      if (weeklyLockMode) {
        if (weekLocked) {
          throw new HttpsError('failed-precondition', 'WEEK_LOCKED: All picks in weekly lock pools are locked.');
        }

        // Validate unique confidence set if enabled
        if (settings.confidenceMode) {
          const confResult = validateConfidenceValues(picks, confidence || {}, games);
          if (!confResult.valid) {
            throw new HttpsError('invalid-argument', confResult.error ?? 'Invalid confidence values.');
          }
        }
      } else {
        // PER_GAME lock checks
        for (const [gameId, pickedTeam] of Object.entries(picks)) {
          const game = games.find(g => g.id === gameId);
          if (!game) throw new HttpsError('invalid-argument', `Game ${gameId} not found.`);

          const isGameLocked = isGameLockedAt(now, game.startTime, week, lockSettings);
          const oldPick = existingEntry?.picks?.[gameId];

          if (isGameLocked && oldPick !== pickedTeam) {
            throw new HttpsError('failed-precondition', `GAME_LOCKED: Pick for game ${gameId} is locked.`);
          }
        }
      }

      // Update Pick'em Entry. NOTE: `confidence` must be spread conditionally —
      // a literal `undefined` field crashes the Firestore serializer (this project
      // deliberately does NOT set ignoreUndefinedProperties), which made EVERY
      // submission to a non-confidence pick'em pool throw INTERNAL. Pre-existing;
      // found by the first real-path Golden Scenario (PLAN-NFL-SIM-HARNESS Phase 2)
      // — same bug class as the weekly-recap P0 in PR #152.
      const pickemEntry: NFLPickemEntry = {
        id: uid,
        poolId,
        ownerUid: uid,
        userName: ctx.subjectName || 'Participant',
        picks: { ...(existingEntry?.picks || {}), ...picks },
        ...(settings.confidenceMode && confidence ? { confidence } : {}),
        weeklyTiebreakers: {
          ...(existingEntry?.weeklyTiebreakers || {}),
          ...(tiebreakerPrediction !== undefined ? { [week]: tiebreakerPrediction } : {})
        },
        totalScore: existingEntry?.totalScore ?? 0,
        submittedAt: now,
        paidStatus: existingEntry?.paidStatus ?? 'UNPAID'
      };

      transaction.set(entryRef, {
        ...pickemEntry,
        ...(requestId ? { lastRequestId: requestId } : {}),
        // Per-entry watermark, advanced INSIDE this transaction so a submission
        // that commits after the scorer read entries still changes the week
        // fingerprint and forces one more pass (lib/entryRevision.ts).
        [ENTRY_REVISION_FIELD]: nextEntryRevision((existingEntry as any)?.[ENTRY_REVISION_FIELD]),
      }, { merge: true });

    } else if (type === 'NFL_SURVIVOR') {
      const survivorEntry = (existingEntry as SurvivorEntry) || {
        id: uid,
        poolId,
        ownerUid: uid,
        userName: ctx.subjectName || 'Participant',
        status: 'ALIVE',
        strikesUsed: 0,
        rebuysUsed: 0,
        usedTeams: [],
        picks: {},
        exemptWeeks: [],
        submittedAt: now,
        paidStatus: 'UNPAID'
      };

      if (survivorEntry.status === 'ELIMINATED') {
        throw new HttpsError('failed-precondition', 'ELIMINATED: Eliminated players cannot submit picks.');
      }

      const teamPicked = picks[week]; // Keyed by week index e.g. week 1
      if (!teamPicked) {
        throw new HttpsError('invalid-argument', 'Missing Survivor team selection.');
      }

      // Check single-pick reuse
      if (survivorEntry.usedTeams.includes(teamPicked)) {
        throw new HttpsError('invalid-argument', `TEAM_ALREADY_USED: You have already picked the ${teamPicked} this season.`);
      }

      // Validate team is playing and not on bye
      const game = games.find(g => g.homeTeam.abbreviation === teamPicked || g.awayTeam.abbreviation === teamPicked);
      if (!game) {
        throw new HttpsError('invalid-argument', `TEAM_NOT_PLAYING: The ${teamPicked} are not playing in week ${week}.`);
      }

      // HARD weekly lock, derived from the pool TYPE (not settings.lockMode) so a
      // settings write that omits or changes lockMode cannot reopen picks mid-week.
      const isWeeklyLock = usesWeeklyHardLock(type) || pool.settings?.lockMode === 'WEEKLY';
      if (isWeeklyLock && weekLocked) {
        throw new HttpsError('failed-precondition', 'WEEK_LOCKED: Survivor picks are locked for this week.');
      }

      const isGameLocked = isGameLockedAt(now, game.startTime, week, lockSettings);
      const oldPick = survivorEntry.picks?.[week];
      if (!isWeeklyLock && isGameLocked && oldPick !== teamPicked) {
        throw new HttpsError('failed-precondition', `GAME_LOCKED: The game for ${teamPicked} has already locked.`);
      }

      // Update used teams and selections
      const oldUsed = survivorEntry.usedTeams.filter(t => t !== survivorEntry.picks[week]);
      survivorEntry.picks[week] = teamPicked;
      survivorEntry.usedTeams = [...new Set([...oldUsed, teamPicked])];
      survivorEntry.submittedAt = now;

      transaction.set(entryRef, {
        ...survivorEntry,
        ...(requestId ? { lastRequestId: requestId } : {}),
        [ENTRY_REVISION_FIELD]: nextEntryRevision((existingEntry as any)?.[ENTRY_REVISION_FIELD]),
      }, { merge: true });

    } else if (type === 'NFL_MARGIN') {
      const marginEntry = (existingEntry as MarginEntry) || {
        id: uid,
        poolId,
        ownerUid: uid,
        userName: ctx.subjectName || 'Participant',
        picks: {},
        usedTeams: [],
        weeklyScores: {},
        seasonTotal: 0,
        negativeBurden: 0,
        positiveWeeks: 0,
        bestWeek: 0,
        submittedAt: now,
        paidStatus: 'UNPAID'
      };

      const teamPicked = picks[week];
      if (!teamPicked) {
        throw new HttpsError('invalid-argument', 'Missing Margin team selection.');
      }

      // Check single-pick reuse
      if (marginEntry.usedTeams.includes(teamPicked)) {
        throw new HttpsError('invalid-argument', `TEAM_ALREADY_USED: You have already picked the ${teamPicked} this season.`);
      }

      // Validate team playing
      const game = games.find(g => g.homeTeam.abbreviation === teamPicked || g.awayTeam.abbreviation === teamPicked);
      if (!game) {
        throw new HttpsError('invalid-argument', `TEAM_NOT_PLAYING: The ${teamPicked} are not playing in week ${week}.`);
      }

      // HARD weekly lock, derived from the pool TYPE — see the Survivor branch.
      const isWeeklyLock = usesWeeklyHardLock(type) || pool.settings?.lockMode === 'WEEKLY';
      if (isWeeklyLock && weekLocked) {
        throw new HttpsError('failed-precondition', 'WEEK_LOCKED: Margin picks are locked for this week.');
      }

      const isGameLocked = isGameLockedAt(now, game.startTime, week, lockSettings);
      const oldPick = marginEntry.picks?.[week];
      if (!isWeeklyLock && isGameLocked && oldPick !== teamPicked) {
        throw new HttpsError('failed-precondition', `GAME_LOCKED: The game for ${teamPicked} has already locked.`);
      }

      const oldUsed = marginEntry.usedTeams.filter(t => t !== marginEntry.picks[week]);
      marginEntry.picks[week] = teamPicked;
      marginEntry.usedTeams = [...new Set([...oldUsed, teamPicked])];
      marginEntry.submittedAt = now;

      transaction.set(entryRef, {
        ...marginEntry,
        ...(requestId ? { lastRequestId: requestId } : {}),
        [ENTRY_REVISION_FIELD]: nextEntryRevision((existingEntry as any)?.[ENTRY_REVISION_FIELD]),
      }, { merge: true });
    }

    // Base-dues stamp (ADR 0005 Phase 4): submitting a playable entry starts fee
    // liability — this is the moment a seeded owner's feeOwed upgrades 0 -> fee,
    // and it heals records that predate the feeOwed field (fill-on-touch).
    ensureMemberRecord(transaction, db, poolId, uid, {
      userName: ctx.subjectName || 'Participant',
      role: existingMember?.role ?? (pool.ownerId === uid ? 'MANAGER' : 'PARTICIPANT'),
      poolType: type,
      present: true,
      entryFee: Number(pool.settings?.entryFee ?? 0),
      hasPlayableEntry: true,
    }, existingMember, now);
  }));

  // Fully-open live consensus (2026-07-09): refresh this pool's week immediately so the crowd
  // split updates on every submit, not at kickoff. Idempotent full-week recompute; non-fatal so
  // a consensus hiccup never fails the pick submission.
  try {
    await recomputeWeekConsensus(db, String(pool.season), Number(pool.seasonType || 2), Number(week), Date.now());
  } catch (e) {
    console.error('[submitNFLPicks] consensus recompute failed:', e);
  }

  return { success: true };
}

/**
 * Securely submits picks for an NFL Pool with strict server-side kickoff lock checks.
 */
export const submitNFLPicks = validated(
  // Shape enforced at the gate; membership/spread/lock/used-teams gates stay
  // in submitNFLPicksInternal (also driven by the sim harness, ADR 0006).
  { schema: submitNFLPicksSchema, label: "submitNFLPicks", appCheck: "monitor" },
  async (input, request) => {
    await assertNotBannedLive(request.auth!.uid);
    const token = request.auth!.token as { name?: string; role?: string };
    return submitNFLPicksInternal(
      admin.firestore(),
      {
        actorUid: request.auth!.uid,
        actorRole: token?.role,
        subjectUid: request.auth!.uid,
        subjectName: token?.name,
        requestId: input.requestId,
      },
      input,
    );
  },
);

/**
 * Survivor rebuy, extracted verbatim from the executeSurvivorRebuy callable
 * (auth check stays in the wrapper). Enforced against ctx.subjectUid.
 */
export async function executeSurvivorRebuyInternal(
  db: admin.firestore.Firestore,
  ctx: MemberActionContext,
  payload: { poolId?: string; week?: number },
): Promise<{ success: true }> {
  const uid = ctx.subjectUid;
  const { poolId, week } = payload || {};

  if (!poolId || !week) {
    throw new HttpsError('invalid-argument', 'poolId and week are required.');
  }

  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) {
    throw new HttpsError('not-found', 'Pool not found.');
  }

  const pool = poolSnap.data() as NFLSurvivorPool;
  if (pool.type !== 'NFL_SURVIVOR') {
    throw new HttpsError('invalid-argument', 'Rebuys are only applicable to Survivor pools.');
  }

  const settings = pool.settings;
  
  // 1. Verify Deadline cutoff
  if (week > settings.rebuyDeadlineWeek) {
    throw new HttpsError('failed-precondition', `PAST_DEADLINE: Rebuys are blocked after week ${settings.rebuyDeadlineWeek}.`);
  }

  const entryRef = poolRef.collection('entries').doc(uid);
  const memberRef = membersCol(db, poolId).doc(uid);
  const rebuyAmt = settings.rebuyCost ?? settings.entryFee ?? 0;

  await retryWhileScoring(() => db.runTransaction(async (transaction) => {
    // Same mutex as pick submission: a rebuy flips ELIMINATED → ALIVE and wipes
    // the strike ledger, so interleaving it with a scoring pass that is writing
    // strikes from a pre-rebuy snapshot re-eliminates the player who just paid.
    await assertNoScoringInProgress(transaction, poolRef, Date.now());
    const entrySnap = await transaction.get(entryRef);
    // Member Record read (before writes) so rebuy dues land on the roster (ADR 0003).
    const memberSnap = await transaction.get(memberRef);
    if (!entrySnap.exists) {
      throw new HttpsError('not-found', 'Participant entry not found.');
    }

    const entry = entrySnap.data() as SurvivorEntry;
    if (entry.status !== 'ELIMINATED') {
      throw new HttpsError('failed-precondition', 'NOT_ELIMINATED: Player is still alive.');
    }

    // 2. Verify Limit
    if (entry.rebuysUsed >= settings.maxRebuys) {
      throw new HttpsError('failed-precondition', `MAX_REBUYS_EXCEEDED: You have reached the limit of ${settings.maxRebuys} rebuys.`);
    }

    // 3. Reset strikes, increment rebuysUsed, retain previously used teams.
    // strikeWeeks is the per-week strike ledger scoreNFLWeek recomputes
    // strikesUsed from — a rebuy wipes both together.
    transaction.update(entryRef, {
      status: 'ALIVE',
      strikesUsed: 0,
      strikeWeeks: [],
      // Rescoring a week at/before the rebuy must not re-strike a player who
      // bought back in — scoreNFLWeek skips strike recomputation for weeks
      // <= lastRebuyWeek.
      lastRebuyWeek: week,
      rebuysUsed: entry.rebuysUsed + 1,
      eliminatedWeek: null,
      // A rebuy is an entry mutation like any other — without the bump the
      // scorer's fingerprint is unchanged and the revived entry is skipped.
      [ENTRY_REVISION_FIELD]: nextEntryRevision((entry as any)[ENTRY_REVISION_FIELD]),
    });

    // 4. Add rebuy dues to the Member Record so Dues Expected reflects them.
    if (memberSnap.exists) {
      transaction.set(memberRef, { rebuyOwed: (memberSnap.data()?.rebuyOwed || 0) + rebuyAmt }, { merge: true });
    } else {
      transaction.set(memberRef, {
        uid, poolId,
        userName: entry.userName || ctx.subjectName || 'Participant',
        role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: Date.now(), rebuyOwed: rebuyAmt,
      }, { merge: false });
    }
  }));

  await writeAuditEvent({
    poolId,
    type: 'SURVIVOR_REBUY',
    message: `Participant ${uid} successfully purchased Survivor Rebuy #${week}`,
    severity: 'INFO',
    actor: { uid, role: 'USER', label: 'Participant' },
    payload: { week }
  });

  // Money event: rebuy adds dues owed to the commissioner — record it where
  // the member can see it, with amount and timestamp
  const rebuyAmount = settings.rebuyCost ?? settings.entryFee ?? undefined;
  await writeLedgerEvent(db, poolId, {
    type: 'REBUY_DUE',
    uid,
    entryId: uid,
    amount: typeof rebuyAmount === 'number' ? rebuyAmount : undefined,
    note: `Survivor rebuy (week ${week})`,
    actorUid: uid,
  });

  return { success: true };
}

/**
 * Triggers a Survivor rebuy/buy-back for an eliminated participant.
 */
export const executeSurvivorRebuy = validated(
  { schema: executeSurvivorRebuySchema, label: "executeSurvivorRebuy", appCheck: "monitor" },
  async (input, request) => {
    const token = request.auth!.token as { name?: string; role?: string };
    return executeSurvivorRebuyInternal(
      admin.firestore(),
      {
        actorUid: request.auth!.uid,
        actorRole: token?.role,
        subjectUid: request.auth!.uid,
        subjectName: token?.name,
      },
      input,
    );
  },
);

/**
 * What a scoring pass did. Every field is reported on dry runs too — including
 * `standings`, the rows the pass WOULD have published. A dry run that only
 * returned counts would be unverifiable (the count is one row per entry either
 * way); the rows are what make a dry-run trial evidence rather than a claim.
 */
export interface ScoreWeekResult {
  success: true;
  message: string;
  dryRun: boolean;
  /** Whether this pass ran under the mid-week reveal/finalization safeguards. */
  provisional: boolean;
  pickemScored: number;
  survivorScored: number;
  marginScored: number;
  aliveCount: number;
  standings: ReturnType<typeof buildStandingsRows>;
  standingsWritten: boolean;
  recapWritten: boolean;
  /**
   * The finalize check THREW. Finalization is best-effort and deliberately does
   * not fail the scoring pass, which means a season-completing pass can leave a
   * pool unfinalized with nothing to say so — and the backstop sweep is disabled
   * by default. Surfaced so a scheduled caller can decline to record this pass as
   * settled and retry it. `false` also covers "finalize declined cleanly" (season
   * not complete yet), which is the normal mid-season answer, not a failure.
   */
  finalizeFailed: boolean;
  /**
   * Another scoring pass held the fenced lease, so this one did nothing at all —
   * nothing read, nothing written. Distinct from a failure: it is the mutex
   * working. A caller must NOT record this pass as settled; retry later.
   */
  leaseBusy: boolean;
  /**
   * The pool was VOIDED (cancelled / closed out / archived) by the time the lease
   * was held, so this pass did nothing at all. Every caller filters retired pools
   * from its own candidate snapshot, but `cancelPool` takes no lease and can
   * commit in the gap — and `maybeFinalizeNFLPool` only notices cancellation
   * AFTER the entry/standings/recap/audit writes, so it cannot undo them.
   * Like `leaseBusy`, this is nothing-happened, not a failure — but unlike it,
   * retrying will never help.
   */
  poolRetired: boolean;
}

export interface ScoreWeekOptions {
  pool: any;
  games: NFLGame[];
  // Reuses the audit contract's actor so an invalid role fails to compile —
  // the scheduled scorer will pass a SYSTEM actor here.
  actor: AuditOptions['actor'];
  dryRun?: boolean;
  provisional?: boolean;
  /** Injectable clock — the lock gates below are time-dependent. */
  now?: number;
}

/**
 * Scores one NFL week, extracted verbatim from the scoreNFLWeek callable. Auth,
 * the ACTIVE_GAMES gate and the pool/games reads stay in the wrapper — the pool
 * doc and the week's slate are passed IN so a caller that already holds them
 * (the callable today, the scheduled scorer next) never reads them twice.
 *
 * `opts.dryRun` computes every grade and the standings projection and writes
 * NOTHING (the deep-sweep dry-run contract): no entry writes, no standings, no
 * pool markers, no recap, no audit events, no finalize check. The counts still
 * come back, so a dry pass reports what a live pass would have done.
 *
 * `opts.actor` threads audit attribution — without it the extraction would lose
 * the caller identity the inline scorer took from `request.auth`.
 *
 * `opts.provisional` is the whole "this is a live mid-week pass" behavior, and
 * defaults to `false` so every pre-existing caller is byte-identical. When true:
 *  1. Penalties are gated on the WEEKLY lock, not on the pass running, and a made
 *     pick stays untouched until its own picked game concludes.
 *  2. Only concluded, lock-closed games are graded — including the per-week
 *     summary counts, since a raw pick count leaks how many still-open picks each
 *     member has already submitted.
 *  3. No `scoredWeeks`/`scoredThroughWeek` markers and no `maybeFinalizeNFLPool`,
 *     so a mid-week pass on a season's last slate cannot finalize it.
 *  4. No weekly recap (its create trigger fires AI trash-talk, and the later
 *     complete pass would only UPDATE the doc, so it would never refire on
 *     complete standings) and no `SCORE_FINALIZED` audit.
 * `standings/current` IS still written — live standings are the point.
 *
 * CONCURRENCY (PR-B′). A live pass takes the fenced scoring lease for the whole
 * pool before it writes anything, and every write asserts that lease inside its
 * own committing transaction. This is the single point where all scorers
 * serialize, so no caller can forget to. A pass that finds the lease held returns
 * `leaseBusy: true` having read and written NOTHING.
 */
export async function scoreNFLWeekInternal(
  db: admin.firestore.Firestore,
  poolId: string,
  week: number,
  opts: ScoreWeekOptions,
): Promise<ScoreWeekResult> {
  // A dry run writes nothing, so it needs no mutex — and taking one would park a
  // real scoring pass behind a report.
  if (opts.dryRun) return scoreWeekPass(db, poolId, week, opts, undefined);

  // Every scorer goes through here — the scheduled job, the manual "Score Week"
  // button, and (next) the reconciliation drain — so acquiring the lease at this
  // single point is what makes the mutex hold across all of them. Two passes
  // reading the same stale entries would each REPLACE whole weeklyPoints /
  // weeklyScores maps, and the later commit would silently lose the other's work.
  //
  // The lease uses the WALL clock, deliberately not `opts.now`. `opts.now` is the
  // injectable SCORING clock — the auto-scorer captures it once per run and
  // passes the same value to every pool it processes in sequence. A run that has
  // been working for longer than the lease TTL would otherwise write a lease that
  // is already expired, and the first fenced write (which compares against the
  // real clock) would throw FENCE_LOST and score nothing for every pool after
  // that point. Found by codex r1.
  const fence = await acquireScoringLease(db, poolId, Date.now());
  if (!fence) {
    return {
      success: true,
      message: 'Another scoring pass is already running for this pool; nothing was written.',
      dryRun: false, provisional: opts.provisional ?? false,
      pickemScored: 0, survivorScored: 0, marginScored: 0, aliveCount: 0,
      standings: [], standingsWritten: false, recapWritten: false,
      finalizeFailed: false, leaseBusy: true, poolRetired: false,
    };
  }
  try {
    // RE-READ the pool now that the lease is held (codex r2).
    //
    // `opts.pool` was fetched by the caller BEFORE the lease existed, so an
    // `extendWeekDeadline` could have committed in between: it correctly saw no
    // live lease, wrote the override and bumped `lockRevision` — and the fence
    // captured the ALREADY-BUMPED revision, so the revision backstop never fires.
    // Grading from the stale doc would then treat a finished game as revealable
    // and publish it while the newly accepted override keeps picks open. Once the
    // lease is held no further extension can commit, so this one read is the
    // point at which the snapshot becomes trustworthy.
    //
    // Only the POOL is re-read, not the slate: a stale `games` snapshot can only
    // be older, and older can only UNDER-reveal (a game not yet seen as terminal),
    // which is the safe direction. Restated ESPN scores are the reconciliation
    // tier's job (§5b), not this fence's.
    const fresh = (await db.collection('pools').doc(poolId).get()).data();
    if (!fresh) return await scoreWeekPass(db, poolId, week, opts, fence);

    // The same gap, for the other lifecycle write (codex r5). `cancelPool` takes
    // no lease, so it can void the pool between the caller's candidate read and
    // this one. Every caller filters retired pools from its OWN snapshot and
    // `maybeFinalizeNFLPool` only checks cancellation after the writes — this is
    // the one point where the answer is trustworthy, so the refusal belongs here
    // rather than in any single caller.
    if (isVoidedPool(fresh)) {
      return {
        success: true,
        message: 'This pool has been voided; nothing was scored.',
        dryRun: false, provisional: opts.provisional ?? false,
        pickemScored: 0, survivorScored: 0, marginScored: 0, aliveCount: 0,
        standings: [], standingsWritten: false, recapWritten: false,
        finalizeFailed: false, leaseBusy: false, poolRetired: true,
      };
    }

    // `provisional` is derived by the CALLER from the same pre-lease snapshot, and
    // it gates finalization — `scoredWeeks`, `maybeFinalizeNFLPool`, the weekly
    // recap. An override that landed in the gap makes the week incomplete, so a
    // `provisional: false` computed from the stale doc would finalize a week whose
    // pick window is open. Re-derived here, and only ever made MORE provisional:
    // OR-ing preserves a caller (or a test) that deliberately forced it on, and
    // withholding is always the safe direction.
    const provisional = (opts.provisional ?? false)
      || !isWeekComplete(fresh, week, opts.games, opts.now ?? Date.now());
    return await scoreWeekPass(db, poolId, week, { ...opts, pool: fresh, provisional }, fence);
  } finally {
    // Best-effort: a failed release only means the lease expires on its own TTL,
    // which is what the expiry is for. Throwing here would mask the real error.
    await releaseScoringLease(db, poolId, fence).catch((e) => {
      console.warn(`[scoreNFLWeek] lease release failed for ${poolId}:`, e);
    });
  }
}

/**
 * One scoring pass, under a fence when it writes. `fence === undefined` means a
 * dry run: no lease, no writes, no assertions.
 */
async function scoreWeekPass(
  db: admin.firestore.Firestore,
  poolId: string,
  week: number,
  opts: ScoreWeekOptions,
  fence: ScoringFence | undefined,
): Promise<ScoreWeekResult> {
  const { pool, games, actor, dryRun = false, provisional = false, now = Date.now() } = opts;
  const poolRef = db.collection('pools').doc(poolId);
  // Every `fence!` below is safe exactly because of this line. Asserted rather
  // than assumed: a future refactor that reached the write path without a lease
  // would otherwise fence nothing and look fine.
  if (!dryRun && !fence) {
    throw new Error('scoreWeekPass: a writing pass requires a scoring fence.');
  }

  const lockSettings = effectiveLockSettings(pool?.settings, pool?.type);
  const gameLockClosed = (g: NFLGame) => isGameLockedAt(now, g.startTime, week, lockSettings);
  const revealed = (g: NFLGame) => isTerminalGame(g) && gameLockClosed(g);

  // Pick'em grades off this set. On a complete pass it IS `games`, so nothing
  // changes; on a provisional pass it withholds both un-concluded games and
  // concluded-but-still-unlocked ones (the Pick'em override case).
  const gradableGames = provisional ? games.filter(revealed) : games;

  // The weekly deadline for penalty purposes — hard-lock aware (frozen value
  // wins for Survivor/Margin). Read-only: persisting the freeze belongs to the
  // submission path, not to the scorer.
  const weekLockAt = weekLockDecision(
    pool as { type?: string; settings?: typeof pool.settings; hardLockByWeek?: Record<string, unknown> },
    week,
    games.map(g => g.startTime),
  ).lockAt;
  const weekLockPassed = now >= weekLockAt;

  /**
   * Is this entry's week ready to be written on a provisional pass?
   *
   * Two distinct holds, and conflating them is the bug this guards:
   *  - NO PICK: the penalty (Survivor strike / Margin -14) is due at the WEEKLY
   *    LOCK, not merely because a pass fired. The scorer's candidate window
   *    reaches 2h before kickoff, so a pass can run while the pick window is
   *    still open — striking then eliminates a member whose valid pick
   *    submitNFLPicks would afterwards reject as ELIMINATED.
   *  - MADE PICK: the engines do NOT skip a non-terminal picked game —
   *    computeSurvivorWeekUpdate reports `survived: true` and scoreMarginWeek
   *    returns null (→ 0). Writing that would publish an unplayed pick as a
   *    survival or a 0 margin that flips when the game ends.
   */
  const weeklyPickReady = (pick: string | undefined): boolean => {
    if (!provisional) return true;
    // NOTHING about a hard-locked week is due before its deadline — not the
    // no-pick penalty, and not a made pick either. The second half matters for
    // one case: ESPN can mark a game CANCELLED days BEFORE kickoff, which makes
    // it terminal while the pick window is still wide open. Grading it would
    // publish a VOID survival / a 0 margin into member-readable standings —
    // revealing that member's pick — for a pick they can still change, and the
    // value would then flip. For a game that reached a normal FINAL this check
    // is already satisfied (its kickoff has passed, and the weekly lock sits a
    // buffer BEFORE the earliest kickoff), so it costs nothing in the normal
    // path.
    if (!weekLockPassed) return false;
    if (!pick) return true;
    const g = games.find(
      gm => gm.homeTeam.abbreviation === pick || gm.awayTeam.abbreviation === pick,
    );
    return !!g && isTerminalGame(g);
  };

  let pickemScored = 0;
  let survivorScored = 0;
  let marginScored = 0;

  // 2. Fetch all entries
  const entriesSnap = await poolRef.collection('entries').get();
  if (entriesSnap.empty) {
    return {
      success: true, message: 'No entries to score.', dryRun, provisional,
      pickemScored: 0, survivorScored: 0, marginScored: 0, aliveCount: 0,
      standings: [], standingsWritten: false, recapWritten: false,
      finalizeFailed: false, leaseBusy: false, poolRetired: false,
    };
  }

  // Staged, chunked writes — a transaction caps at 500 ops (400 entries + the
  // pool doc's own lease renewal stays well inside it), so pools with >500
  // entries would throw on commit and score nobody.
  //
  // These are TRANSACTIONS rather than plain batches because the fence has to be
  // asserted in the same commit as the data (lib/scoringLease.ts): a separate
  // "do I still hold the lease?" check before a `batch.commit()` is a TOCTOU race
  // — a newer pass can take the lease in between, and the stale writes land
  // anyway. A lost fence throws `aborted` out of here and aborts the whole pass,
  // deliberately: continuing would write grades computed against settings the
  // fence just invalidated.
  let staged: Array<[admin.firestore.DocumentReference, any]> = [];
  // Dry runs never stage a write; they record what WOULD have been written so
  // the two re-read passes below (Margin ranks, standings projection) still see
  // this week's numbers instead of last week's stale committed ones.
  const stagedDry = new Map<string, any>();
  const commitStaged = async () => {
    if (staged.length === 0) return;
    const chunk = staged;
    staged = [];
    await fencedWrite(db, poolRef, fence!, (tx) => {
      for (const [ref, data] of chunk) tx.update(ref, data);
    });
  };
  const stage = async (ref: admin.firestore.DocumentReference, data: any) => {
    if (dryRun) {
      stagedDry.set(ref.path, { ...(stagedDry.get(ref.path) || {}), ...data });
      return;
    }
    staged.push([ref, data]);
    if (staged.length >= 400) await commitStaged();
  };
  const flushBatch = async () => {
    if (dryRun) return;
    await commitStaged();
  };
  // Post-write view of the entries. Live: re-read (authoritative, unchanged).
  // Dry: the pre-read docs with the staged updates merged over them.
  const readScoredEntries = async (): Promise<any[]> => {
    if (dryRun) {
      return entriesSnap.docs.map(d => ({
        ...(d.data() as any),
        ...(stagedDry.get(d.ref.path) || {}),
        id: d.id,
      }));
    }
    const snap = await poolRef.collection('entries').get();
    return snap.docs.map(d => ({ ...(d.data() as any), id: d.id }));
  };

  // Recaps highlighting metrics
  let sharpUser: { uid: string; name: string; val: number } | null = null;
  const biggestUpset: { uid: string; name: string; gameId: string; team: string } | null = null;
  let closestTie: { uid: string; name: string; diff: number } | null = null;

  // MNF tiebreaker target: combined score of ALL Monday games, resolved only
  // once every Monday game is FINAL (dual-MNF weeks; mid-Monday admin scoring
  // stays provisional and a rescore recomputes it).
  const mnfTotalScore = computeMNFTiebreakerTotal(games);

  // Survivor tracking
  let aliveCount = 0;
  const pendingStrikeAudits: Array<{ userName: string }> = [];

  for (const doc of entriesSnap.docs) {
    const entryRef = doc.ref;

    if (pool.type === 'NFL_PICKEM') {
      const entry = doc.data() as NFLPickemEntry;
      const { points, correctCount } = scorePickemEntry(entry, gradableGames, pool);

      const weeklyPoints = { ...(entry.weeklyPoints || {}), [week]: points };
      const totalScore = Object.values(weeklyPoints).reduce((sum, p) => sum + p, 0);

      // Persist the real per-week W-L (correct/total) that scorePickemEntry already computes
      // and previously discarded — makes accuracy truthful (ADR 0004). resultsVersion lets the
      // Phase E per-user aggregate recompute idempotently. Per-game graded outcomes + pick
      // mode added by ADR 0005 (written post-final only — reveal-safe; rescore overwrites).
      // Counted over the GRADABLE set, not the whole slate. buildStandingsRows
      // copies `total` into member-readable standings/current, so on a
      // provisional pass a raw slate count would tell every member how many
      // still-open picks each rival has already submitted — a reveal hole even
      // though the grades themselves are lock-safe.
      const picksThisWeek = gradableGames.filter(g => !!entry.picks?.[g.id]).length;
      const weeklyResults = {
        ...((entry as any).weeklyResults || {}),
        [week]: {
          correct: correctCount,
          total: picksThisWeek,
          points,
          mode: pool.settings?.pickMode === 'ATS' ? 'ATS' : 'STRAIGHT',
          games: gradePickemGames(entry, gradableGames, pool),
        },
      };

      await stage(entryRef, {
        weeklyPoints,
        totalScore,
        weeklyResults,
        resultsVersion: (((entry as any).resultsVersion) || 0) + 1,
      });
      pickemScored++;

      // Sharp calculation
      if (!sharpUser || points > sharpUser.val) {
        sharpUser = { uid: entry.ownerUid, name: entry.userName, val: points };
      }

      // Tiebreaker
      if (mnfTotalScore !== null) {
        const prediction = entry.weeklyTiebreakers?.[week] ?? 0;
        const diff = Math.abs(prediction - mnfTotalScore);
        if (!closestTie || diff < closestTie.diff) {
          closestTie = { uid: entry.ownerUid, name: entry.userName, diff };
        }
      }

    } else if (pool.type === 'NFL_SURVIVOR') {
      const entry = doc.data() as SurvivorEntry;

      // Mid-week hold: nothing is written for this entry's week until its
      // penalty is actually due (weekly lock passed) or its own pick concluded.
      if (!weeklyPickReady(entry.picks?.[week])) {
        if (entry.status !== 'ELIMINATED') aliveCount++;
        continue;
      }

      // The FULL slate is passed on purpose — checkAutoSurviveExemption derives
      // "teams playing this week" from it, so a filtered list would invent an
      // exemption for a member whose only remaining teams simply have not
      // kicked off yet.
      // Idempotent per-(entry, week) recompute — set semantics, revive-capable
      // on rescore, rebuy-aware, strike audit deduped. See
      // computeSurvivorWeekUpdate for the full contract.
      const result = computeSurvivorWeekUpdate(entry, week, games, pool);

      if (!result.skipped) {
        // ADR 0004/0005: per-week scored outcome + per-pick game record, idempotent
        // (rescore overwrites this week's key), versioned for the profile recompute.
        const struckThisWeek = result.update.strikeWeeks.includes(week);
        const game = gradeSurvivorWeekGame(entry, week, games, struckThisWeek);
        const weeklyResults = {
          ...((entry as any).weeklyResults || {}),
          [week]: {
            survived: !struckThisWeek,
            strike: struckThisWeek,
            ...(game ? { game } : {}),
          },
        };
        await stage(entryRef, {
          ...result.update,
          weeklyResults,
          resultsVersion: (((entry as any).resultsVersion) || 0) + 1,
        });
        survivorScored++;
      }
      if (result.alive) aliveCount++;

      // BUFFERED, not written here. An audit event cannot participate in the
      // fenced transaction (different collection, its own writer), and a strike
      // audit is the one artifact a retry cannot un-write — so it is emitted only
      // after the entry writes it describes have actually committed under the
      // fence. A pass that loses the lease throws out of the flush below and
      // never reaches this, which is the point.
      if (result.strikeIsNew && !dryRun) {
        pendingStrikeAudits.push({ userName: entry.userName });
      }

    } else if (pool.type === 'NFL_MARGIN') {
      const entry = doc.data() as MarginEntry;
      const pick = entry.picks[week];
      let weekScore = 0;

      // Same mid-week hold as Survivor: the -14 is due at the weekly lock, and a
      // made pick must not be published as a 0 that flips when its game ends.
      if (!weeklyPickReady(pick)) continue;

      if (pick) {
        const res = scoreMarginWeek(pick, games);
        weekScore = res ?? 0;
      } else {
        // Auto-Strike / Non-submission in Margin counts as -14 (standard heavy burden penalty)
        weekScore = -14;
      }

      const weeklyScores = { ...(entry.weeklyScores || {}), [week]: weekScore };
      const seasonTotal = Object.values(weeklyScores).reduce((sum, s) => sum + s, 0);

      // Compute negative burden
      const negativeBurden = Object.values(weeklyScores)
        .filter(s => s < 0)
        .reduce((sum, s) => sum + Math.abs(s), 0);

      // Positive weeks count
      const positiveWeeks = Object.values(weeklyScores).filter(s => s > 0).length;

      // Best single week
      const bestWeek = Object.values(weeklyScores).length > 0 ? Math.max(...Object.values(weeklyScores)) : 0;

      // ADR 0004/0005: per-week scored outcome + per-pick game record, idempotent + versioned.
      const game = gradeMarginWeekGame(pick, games);
      const weeklyResults = {
        ...((entry as any).weeklyResults || {}),
        [week]: { net: weekScore, ...(game ? { game } : {}) },
      };

      await stage(entryRef, {
        weeklyScores,
        seasonTotal,
        negativeBurden,
        positiveWeeks,
        bestWeek,
        weeklyResults,
        resultsVersion: (((entry as any).resultsVersion) || 0) + 1
      });
      marginScored++;
    }
  }

  // 3. Margin leaderboard sorting.
  //
  // Gated on something actually having been scored. A provisional pass whose
  // picks are all still pending scores nobody, and ranks derived from unchanged
  // season totals are unchanged too — but staging them anyway is a write per
  // entry, every poll, each one firing the entry-change profile recompute. That
  // pool also banks no fingerprint (by design, so a late entry is not skipped
  // forever), so the retry is meant to be read-only.
  if (pool.type === 'NFL_MARGIN' && marginScored > 0) {
    // Flush pending score writes first so the re-read ranks on THIS week's
    // fresh totals rather than last week's stale data.
    await flushBatch();
    const updatedEntries = (await readScoredEntries()) as MarginEntry[];
    const ranked = sortMarginLeaderboard(updatedEntries);

    // Write standings back
    for (let index = 0; index < ranked.length; index++) {
      const r = ranked[index];
      const docRef = poolRef.collection('entries').doc(r.ownerUid);
      await stage(docRef, { rank: index + 1 });
    }
  }

  await flushBatch();

  // Strike audits, now that the entry writes they describe have committed.
  //
  // A `SURVIVOR_AUTO_STRIKE` is immutable — a corrective rescore cannot remove
  // one — and this loop is serial, so on a large pool it can outlive the lease
  // and keep emitting strikes from a superseded pass (codex r2). It cannot be
  // done inside the fenced transaction (different collection, its own writer), so
  // the fence is re-asserted and RENEWED as the loop runs. The renewal is
  // time-based rather than per-audit: an empty fenced write is a transaction on
  // the pool doc, and one per strike would serialize hundreds of them.
  let lastFenceTouch = Date.now();
  for (const strike of pendingStrikeAudits) {
    if (fence && Date.now() - lastFenceTouch > fence.ttlMs / 2) {
      await fencedWrite(db, poolRef, fence, () => {});
      lastFenceTouch = Date.now();
    }
    await writeAuditEvent({
      poolId,
      type: 'SURVIVOR_AUTO_STRIKE',
      message: `Participant ${strike.userName} suffered a strike in week ${week}`,
      severity: 'WARNING',
      actor: { uid: 'system', role: 'SYSTEM', label: 'Scoring Engine' },
      payload: { week }
    });
  }

  // 3b. Member-readable standings projection + pool-level scoring markers (ADR 0005
  // Phase 2). Written AFTER all entry writes commit so rows reflect this scoring pass
  // (including the Margin rank pass). Rows are allowlist-built — no picks, confidence,
  // tiebreakers, or usedTeams (usedTeams updates at submit time and would leak the
  // current week's un-scored pick). This projection is what member views read once
  // raw entry reads tighten to own-entry-only.
  // ponytail: single doc, fine for realistic pool sizes; shard to standings/part_N
  // before the 1MB doc limit if a pool ever has >500 entries (ADR 0004 shard path).
  const standingsRows = buildStandingsRows(pool.type, await readScoredEntries());
  const recapWritten = !dryRun && !provisional;
  let finalizeFailed = false;
  if (!dryRun) {
    // The standings publish and the publication marker land in ONE fenced
    // transaction. The marker must not be able to lag the reveal it certifies:
    // `extendWeekDeadline` reads it transactionally, so a marker written a moment
    // after the rows would leave a window in which an extension is accepted for a
    // week whose result members can already see.
    const standingsDoc = {
      poolType: pool.type,
      season: String(pool.season ?? ''),
      lastScoredWeek: week,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      rows: standingsRows,
    };

    // Publication marker — set-once, and NOT provisional-only. It is the durable
    // evidence that a week's result has been shown to members, which the
    // deadline-extension guard reads. A one-game slate (the HOF opener) finishes
    // in a single COMPLETE pass, so gating this on `provisional` would publish
    // standings with no marker and leave the week reopenable after its result
    // was exposed. Stamped only when something was actually revealed, so a pass
    // that fires 2h before kickoff with nothing concluded does not claim
    // publication.
    const revealedAny = games.some(revealed);
    await fencedWrite(db, poolRef, fence!, (tx) => {
      tx.set(poolRef.collection('standings').doc('current'), standingsDoc);
    }, {
      lastScoredAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(revealedAny ? { [`publishedWeeks.${week}`]: true } : {}),
      // Finalization-sensitive markers are withheld on a provisional pass:
      // maybeFinalizeNFLPool keys off scoredWeeks + terminal game status and does
      // NOT consult effective locks, so writing them mid-week would let a pass on
      // the season's last slate finalize the pool while picks are still open.
      ...(provisional ? {} : {
        scoredThroughWeek: Math.max(Number(pool.scoredThroughWeek || 0), Number(week)),
        // Which weeks have actually been scored (out-of-order safe) — the Season
        // Finalization completeness check reads this, not scoredThroughWeek.
        [`scoredWeeks.${week}`]: true,
      }),
    });

    if (!provisional) {
      // 3c. Season Finalization (ADR 0005 Phase 3): if this scoring pass completed the
      // season, finalize automatically — stats never wait on a human. Best-effort:
      // a finalize failure must never fail the scoring call (the sweep job catches up).
      //
      // The fence is threaded IN rather than rechecked around the call: the
      // finalizer writes season history and stamps `finalizedAt`, and a pass that
      // lost its lease must not do either from a partially-updated entry set.
      try {
        await maybeFinalizeNFLPool(db, poolId, { fence });
      } catch (e) {
        finalizeFailed = true;
        console.warn(`[scoreNFLWeek] finalize check failed for ${poolId} (sweep will retry):`, e);
      }

      // 4. Generate automated Weekly Recap. buildWeeklyRecap omits undefined
      // optional fields — Firestore's set() throws on a literal `undefined` value
      // (no ignoreUndefinedProperties here), which crashed every prior call that
      // had no sharp user / no MNF tiebreaker / a non-Survivor pool.
      const recapRef = poolRef.collection('weekly_recaps').doc(`week_${week}`);
      const recapDoc = buildWeeklyRecap({ poolId, week, poolType: pool.type, sharpUser, closestTie, aliveCount });
      // Fenced: creating this doc fires onWeeklyRecapCreated → AI trash-talk, and
      // the later authoritative pass only UPDATEs it, so a recap created from a
      // pass that lost its lease can never be regenerated on correct standings.
      await fencedWrite(db, poolRef, fence!, (tx) => { tx.set(recapRef, recapDoc); });

      await writeAuditEvent({
        poolId,
        type: 'SCORE_FINALIZED',
        message: `NFL Pool Scoring concluded for Week ${week}`,
        severity: 'INFO',
        actor: actor,
        payload: { week }
      });
    }
  }

  return {
    success: true,
    message: dryRun
      ? `Week ${week} dry run — nothing written.`
      : provisional
        ? `Week ${week} scored provisionally — live standings updated.`
        : `Week ${week} scored successfully.`,
    dryRun,
    provisional,
    pickemScored,
    survivorScored,
    marginScored,
    aliveCount,
    standings: standingsRows,
    standingsWritten: !dryRun,
    recapWritten,
    finalizeFailed,
    leaseBusy: false, poolRetired: false,
  };
}

/**
 * Evaluates and scores an NFL week. Fetches all games, parses scores, evaluates picks,
 * updates standings, and creates automated weekly recap summaries.
 * SuperAdmin or Pool Owner only.
 */
export const scoreNFLWeek = validated(
  // owner/SUPER_ADMIN check happens in-handler (assertPoolOwnerOrSuperAdmin
  // needs the pool doc's owner fields, unavailable at the role-gate stage).
  { schema: scoreNFLWeekSchema, label: "scoreNFLWeek", appCheck: "monitor" },
  async ({ poolId, week }, request) => {
    const uid = request.auth!.uid;
    const db = admin.firestore();

    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
      throw new HttpsError('not-found', 'Pool not found.');
    }

    const pool = poolSnap.data() as any;

    // RBAC checks
    const userRole = request.auth!.token.role || 'USER';
    try {
      assertPoolOwnerOrSuperAdmin(pool, uid, userRole);
    } catch {
      throw new HttpsError('permission-denied', 'Only pool managers or super admins can trigger scoring.');
    }

    // 1. Retrieve all NFL games for this season and week
    const gamesSnap = await db.collection('nfl_games')
      .where('season', '==', pool.season)
      .where('seasonType', '==', Number(pool.seasonType || 2))
      .where('week', '==', week)
      .get();

    const games = gamesSnap.docs.map(doc => doc.data() as NFLGame);
    if (games.length === 0) {
      throw new HttpsError('failed-precondition', `No games found to score for week ${week}.`);
    }

    // Confirm all games are final
    const activeGamesCount = games.filter(g => g.status !== 'FINAL' && g.status !== 'CANCELLED').length;
    if (activeGamesCount > 0 && userRole !== 'SUPER_ADMIN') {
      throw new HttpsError('failed-precondition', `ACTIVE_GAMES: Cannot score the week while ${activeGamesCount} games are still active.`);
    }

    // The pool doc and the slate are already in hand — pass them down rather
    // than paying for the same two reads again inside the scorer.
    //
    // `provisional` is DERIVED here, not hard-coded false. The ACTIVE_GAMES gate
    // above exempts SUPER_ADMIN, so this button can score mid-week — and a
    // hard-coded `false` would then apply Survivor strikes, Margin -14s and
    // finalization artifacts while later pick windows are still open, which is
    // the exact hazard the flag exists to prevent. On a normal end-of-week score
    // every game is concluded and locked, so this is `false` and the button
    // behaves exactly as before.
    const now = Date.now();
    const result = await scoreNFLWeekInternal(db, poolId, week, {
      pool,
      games,
      actor: { uid, role: 'ADMIN', label: 'Host' },
      provisional: !isWeekComplete(pool, week, games, now),
      now,
    });

    // Response shape is unchanged on purpose: dbService.scoreNFLWeek types it as
    // { success, message } and NFLManagerView renders the message.
    return { success: result.success, message: result.message };
  },
);
