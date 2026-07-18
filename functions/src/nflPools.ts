import * as admin from 'firebase-admin';
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from 'firebase-functions/v2/https';
import { writeAuditEvent } from "./audit";
import { checkBillingAccess } from "./billing";
import { writeLedgerEvent } from "./paymentLedger";
import { assertPoolOwnerOrSuperAdmin, stripPrivilegedPoolFields, computeLaunchMode, assertPaidParticipantCeiling, simRunIdForCreate } from "./poolOps";
import { loadBillingConfig } from "./billing";
import { assertPoolCreationAllowed, assertNotMaintenance, assertNotBannedLive } from "./lib/systemGuards";
import { isPoolType, type PoolType } from "./shared/poolTypes";
import { ensureMemberRecord, membersCol } from "./lib/memberRecord";
import type { MemberRecord } from "./shared/memberRecord";
import { effectiveWeekLockAt, isGameLocked as isGameLockedAt } from "./lib/effectiveLock";
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
  buildStandingsRows
} from './nflScoringEngine';
import { maybeFinalizeNFLPool } from './nflFinalize';
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
  const now = Date.now();

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

  // 1.5 Global Spread Validation
  // Ensure that all games for the current week have their spreads locked before accepting any picks.
  const allSpreadsLocked = games.every(g => g.spread?.locked === true);
  if (!allSpreadsLocked) {
    throw new HttpsError('failed-precondition', 'SPREADS_NOT_LOCKED: Picks cannot be submitted until all game spreads for the week are finalized and locked.');
  }

  // 2. Determine lock context — single source of truth (effectiveLock helper, ADR 0004).
  // Folds in lock buffer + per-game kickoff + commissioner week override; every per-game
  // check below uses isGameLockedAt so the override is always respected.
  const effectiveWeekLock = effectiveWeekLockAt(games.map(g => g.startTime), week, pool.settings);
  const weekLocked = now >= effectiveWeekLock;

  // Write variables inside transactions
  const entryRef = poolRef.collection('entries').doc(uid);

  await db.runTransaction(async (transaction) => {
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

          const isGameLocked = isGameLockedAt(now, game.startTime, week, pool.settings);
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

      transaction.set(entryRef, { ...pickemEntry, ...(requestId ? { lastRequestId: requestId } : {}) }, { merge: true });

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

      const isWeeklyLock = pool.settings?.lockMode === 'WEEKLY';
      if (isWeeklyLock && weekLocked) {
        throw new HttpsError('failed-precondition', 'WEEK_LOCKED: Survivor pools lock at the kickoff of the first game.');
      }

      const isGameLocked = isGameLockedAt(now, game.startTime, week, pool.settings);
      const oldPick = survivorEntry.picks?.[week];
      if (!isWeeklyLock && isGameLocked && oldPick !== teamPicked) {
        throw new HttpsError('failed-precondition', `GAME_LOCKED: The game for ${teamPicked} has already locked.`);
      }

      // Update used teams and selections
      const oldUsed = survivorEntry.usedTeams.filter(t => t !== survivorEntry.picks[week]);
      survivorEntry.picks[week] = teamPicked;
      survivorEntry.usedTeams = [...new Set([...oldUsed, teamPicked])];
      survivorEntry.submittedAt = now;

      transaction.set(entryRef, { ...survivorEntry, ...(requestId ? { lastRequestId: requestId } : {}) }, { merge: true });

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

      const isWeeklyLock = pool.settings?.lockMode === 'WEEKLY';
      if (isWeeklyLock && weekLocked) {
        throw new HttpsError('failed-precondition', 'WEEK_LOCKED: Margin pools lock at the kickoff of the first game.');
      }

      const isGameLocked = isGameLockedAt(now, game.startTime, week, pool.settings);
      const oldPick = marginEntry.picks?.[week];
      if (!isWeeklyLock && isGameLocked && oldPick !== teamPicked) {
        throw new HttpsError('failed-precondition', `GAME_LOCKED: The game for ${teamPicked} has already locked.`);
      }

      const oldUsed = marginEntry.usedTeams.filter(t => t !== marginEntry.picks[week]);
      marginEntry.picks[week] = teamPicked;
      marginEntry.usedTeams = [...new Set([...oldUsed, teamPicked])];
      marginEntry.submittedAt = now;

      transaction.set(entryRef, { ...marginEntry, ...(requestId ? { lastRequestId: requestId } : {}) }, { merge: true });
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
  });

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

  await db.runTransaction(async (transaction) => {
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
      eliminatedWeek: null
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
  });

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

  // 2. Fetch all entries
  const entriesSnap = await poolRef.collection('entries').get();
  if (entriesSnap.empty) {
    return { success: true, message: 'No entries to score.' };
  }

  // Staged, chunked writes — a single batch caps at 500 ops, so pools with
  // >500 entries (or >250 Margin entries) would throw on commit and score nobody.
  let batch = db.batch();
  let opCount = 0;
  const stage = async (ref: admin.firestore.DocumentReference, data: any) => {
    batch.update(ref, data);
    if (++opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  };
  const flushBatch = async () => {
    if (opCount > 0) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
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

  for (const doc of entriesSnap.docs) {
    const entryRef = doc.ref;

    if (pool.type === 'NFL_PICKEM') {
      const entry = doc.data() as NFLPickemEntry;
      const { points, correctCount } = scorePickemEntry(entry, games, pool);

      const weeklyPoints = { ...(entry.weeklyPoints || {}), [week]: points };
      const totalScore = Object.values(weeklyPoints).reduce((sum, p) => sum + p, 0);

      // Persist the real per-week W-L (correct/total) that scorePickemEntry already computes
      // and previously discarded — makes accuracy truthful (ADR 0004). resultsVersion lets the
      // Phase E per-user aggregate recompute idempotently. Per-game graded outcomes + pick
      // mode added by ADR 0005 (written post-final only — reveal-safe; rescore overwrites).
      const picksThisWeek = games.filter(g => !!entry.picks?.[g.id]).length;
      const weeklyResults = {
        ...((entry as any).weeklyResults || {}),
        [week]: {
          correct: correctCount,
          total: picksThisWeek,
          points,
          mode: pool.settings?.pickMode === 'ATS' ? 'ATS' : 'STRAIGHT',
          games: gradePickemGames(entry, games, pool),
        },
      };

      await stage(entryRef, {
        weeklyPoints,
        totalScore,
        weeklyResults,
        resultsVersion: (((entry as any).resultsVersion) || 0) + 1,
      });

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
      }
      if (result.alive) aliveCount++;

      if (result.strikeIsNew) {
        await writeAuditEvent({
          poolId,
          type: 'SURVIVOR_AUTO_STRIKE',
          message: `Participant ${entry.userName} suffered a strike in week ${week}`,
          severity: 'WARNING',
          actor: { uid: 'system', role: 'SYSTEM', label: 'Scoring Engine' },
          payload: { week }
        });
      }

    } else if (pool.type === 'NFL_MARGIN') {
      const entry = doc.data() as MarginEntry;
      const pick = entry.picks[week];
      let weekScore = 0;

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
    }
  }

  // 3. Margin leaderboard sorting
  if (pool.type === 'NFL_MARGIN') {
    // Flush pending score writes first so the re-read ranks on THIS week's
    // fresh totals rather than last week's stale data.
    await flushBatch();
    const updatedEntriesSnap = await poolRef.collection('entries').get();
    const updatedEntries = updatedEntriesSnap.docs.map(doc => doc.data() as MarginEntry);
    const ranked = sortMarginLeaderboard(updatedEntries);

    // Write standings back
    for (let index = 0; index < ranked.length; index++) {
      const r = ranked[index];
      const docRef = poolRef.collection('entries').doc(r.ownerUid);
      await stage(docRef, { rank: index + 1 });
    }
  }

  await flushBatch();

  // 3b. Member-readable standings projection + pool-level scoring markers (ADR 0005
  // Phase 2). Written AFTER all entry writes commit so rows reflect this scoring pass
  // (including the Margin rank pass). Rows are allowlist-built — no picks, confidence,
  // tiebreakers, or usedTeams (usedTeams updates at submit time and would leak the
  // current week's un-scored pick). This projection is what member views read once
  // raw entry reads tighten to own-entry-only.
  // ponytail: single doc, fine for realistic pool sizes; shard to standings/part_N
  // before the 1MB doc limit if a pool ever has >500 entries (ADR 0004 shard path).
  const projectionSnap = await poolRef.collection('entries').get();
  const standingsRows = buildStandingsRows(
    pool.type,
    projectionSnap.docs.map(d => ({ ...(d.data() as any), id: d.id })),
  );
  await poolRef.collection('standings').doc('current').set({
    poolType: pool.type,
    season: String(pool.season ?? ''),
    lastScoredWeek: week,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    rows: standingsRows,
  });
  await poolRef.update({
    lastScoredAt: admin.firestore.FieldValue.serverTimestamp(),
    scoredThroughWeek: Math.max(Number(pool.scoredThroughWeek || 0), Number(week)),
    // Which weeks have actually been scored (out-of-order safe) — the Season
    // Finalization completeness check reads this, not scoredThroughWeek.
    [`scoredWeeks.${week}`]: true,
  });

  // 3c. Season Finalization (ADR 0005 Phase 3): if this scoring pass completed the
  // season, finalize automatically — stats never wait on a human. Best-effort:
  // a finalize failure must never fail the scoring call (the sweep job catches up).
  try {
    await maybeFinalizeNFLPool(db, poolId);
  } catch (e) {
    console.warn(`[scoreNFLWeek] finalize check failed for ${poolId} (sweep will retry):`, e);
  }

  // 4. Generate automated Weekly Recap. buildWeeklyRecap omits undefined
  // optional fields — Firestore's set() throws on a literal `undefined` value
  // (no ignoreUndefinedProperties here), which crashed every prior call that
  // had no sharp user / no MNF tiebreaker / a non-Survivor pool.
  const recapRef = poolRef.collection('weekly_recaps').doc(`week_${week}`);
  const recapDoc = buildWeeklyRecap({ poolId, week, poolType: pool.type, sharpUser, closestTie, aliveCount });
  await recapRef.set(recapDoc);

  await writeAuditEvent({
    poolId,
    type: 'SCORE_FINALIZED',
    message: `NFL Pool Scoring concluded for Week ${week}`,
    severity: 'INFO',
    actor: { uid, role: 'ADMIN', label: 'Host' },
    payload: { week }
  });

  return { success: true, message: `Week ${week} scored successfully.` };
  },
);
