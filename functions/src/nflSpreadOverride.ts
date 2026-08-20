// The audited override, and the detector that watches the frozen store
// (PLAN-NFL-SPREAD-FREEZE 2.1 / 2.4, Revision 1).
//
// A frozen line is refused by `firestore.rules` to every client. That makes it
// immutable through the app — which would be wrong on its own, because a wrong
// line has to be correctable and `nflSpreadRescoreTrigger` exists precisely
// because a human sometimes must correct one. So exactly one path can change it,
// it requires a reason, it writes `admin_audit`, and it rides the rescore handoff
// so standings repair.
//
// ⚠️ WHAT THIS CANNOT DO, stated rather than implied away: a Firebase console or
// Admin-SDK write bypasses the rules entirely — the same bypass that lets these
// functions work at all. That path is not PREVENTED; it is DETECTED. The trigger
// below fires on any change whatever wrote it, so the ordinary slip (open the
// console, retype a number) repairs the standings and leaves a trail. Reducing
// who holds datastore-write IAM on the prod project is the real control and is
// Kevin's call.
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { validated } from './lib/validated';
import { adminAuditDoc, writeAdminAudit } from './lib/adminAudit';
import { overrideLockedSpreadSchema } from './schemas/nflPools';
import { FROZEN_SPREADS_COLLECTION, slateFieldsOf, type FrozenSpread } from './shared/frozenSpread';
import { classifyFrozenChange } from './lib/frozenSpreadAudit';
import { enqueueRescore } from './lib/rescoreQueue';

/**
 * 2.1 — set a new value on a frozen line, or give a line to a game that has no
 * frozen record at all.
 *
 * ⚠️ BOTH SHAPES, and the revision nearly dropped the second one (codex round 5 on
 * the revision). Once-per-slate stops the freeze re-running, so if this could only
 * amend an existing record there would be no way to give a LATE-ADDED game a
 * frozen line — R3's whole remediation path gone, the slate permanently
 * incomplete, ATS submissions blocked for good.
 *
 * | Frozen record | What is written |
 * |---|---|
 * | exists | amend: new `value`, new `overrideId`, `source: 'override'`, **`frozenAt` untouched** |
 * | absent | create: `{ value, frozenAt: now, slate, overrideId, source: 'override' }` |
 *
 * ⚠️ AMEND, NEVER REBUILD. Writing `{ value, overrideId, source }` as a whole map
 * drops `frozenAt` and the slate key, and the first legitimate override would then
 * blind the detector to every unauthorised change on that game afterwards — an
 * approved correction quietly disarming the alarm for good (round 9). The update
 * below names fields; it does not replace the document.
 *
 * ⚠️ ONE TRANSACTION FOR THE SPREAD AND THE AUDIT ROW, correlated by an id CARRIED
 * ON THE DOCUMENT (round 3). The obvious version — the trigger goes looking for a
 * recent `admin_audit` override record — races in both directions: writing the
 * spread before the audit row lets the trigger fire in the gap and libel a
 * legitimate override, and `writeAdminAudit` deliberately swallows its own write
 * failures, so the row may never appear at all. With the id on the record the
 * trigger needs no read.
 */
export async function overrideLockedSpreadInternal(
  db: admin.firestore.Firestore,
  actor: { uid: string; email?: string },
  input: { gameId: string; value: number; reason: string },
): Promise<{ success: true; overrideId: string; shape: 'amend' | 'create'; previousValue: number | null }> {
    const { gameId, value, reason } = input;
    const overrideId = randomUUID();
    const now = Date.now();

    const result = await db.runTransaction(async (tx) => {
      const gameRef = db.collection('nfl_games').doc(gameId);
      const frozenRef = db.collection(FROZEN_SPREADS_COLLECTION).doc(gameId);
      const [gameSnap, frozenSnap] = await tx.getAll(gameRef, frozenRef);

      if (!gameSnap.exists) {
        throw new HttpsError('not-found', `No NFL game ${gameId}.`);
      }
      const game = gameSnap.data() as Record<string, unknown>;
      const previous = frozenSnap.exists ? (frozenSnap.data() as FrozenSpread) : undefined;

      let shape: 'amend' | 'create';
      if (previous) {
        shape = 'amend';
        // Named fields only. `frozenAt`, `season`, `seasonType` and `week` are
        // left exactly as the freeze wrote them.
        tx.update(frozenRef, { value, overrideId, source: 'override' });
      } else {
        shape = 'create';
        const slate = slateFieldsOf(game);
        if (!slate) {
          throw new HttpsError('failed-precondition', `Game ${gameId} has no usable slate key; cannot create a frozen line for it.`);
        }

        // ⚠️ THE CREATE SHAPE IS FOR A GAME ADDED TO AN ALREADY-FROZEN SLATE, AND
        // NOTHING ELSE (codex r1 on PR 3).
        //
        // Without this check the callable is a way to freeze one game of an
        // untouched future week — and that is worse than it sounds, because
        // `slateAlreadyFrozen` reads "any record exists for this slate". One
        // override on an unfrozen slate therefore makes the weekly freeze skip
        // that week PERMANENTLY, leaving the other fifteen games unfrozen and
        // every ATS pool on the slate blocked behind SPREADS_NOT_LOCKED with no
        // path back. It would also be a manual freeze before the stated cutoff,
        // by the one door built to bypass the cutoff rule legitimately.
        //
        // A sibling record is exactly the right test: it is present for R3's case
        // (the rest of the week froze days ago) and absent for every other one.
        const siblings = await tx.get(
          db.collection(FROZEN_SPREADS_COLLECTION)
            .where('season', '==', slate.season)
            .where('seasonType', '==', slate.seasonType)
            .where('week', '==', slate.week)
            .limit(1),
        );
        if (siblings.empty) {
          throw new HttpsError(
            'failed-precondition',
            `${slate.season}/${slate.seasonType}/wk${slate.week} has no frozen lines at all, so there is nothing to correct. ` +
            `Freeze the week first (Operations → NFL Spread Freeze); this override exists for a game ADDED to a slate that was already frozen.`,
          );
        }
        const record: FrozenSpread = {
          gameId, value, frozenAt: now, ...slate,
          overrideId,
          // Both paths declare `source: 'override'`. An earlier draft omitted it
          // here and the approval table would then have filed every legitimate
          // override as an unapproved change (codex round 8 on the revision).
          source: 'override',
        };
        tx.create(frozenRef, record);
      }

      // The audit row rides the SAME transaction, carrying the same id. Written
      // through `adminAuditDoc` so it is byte-for-byte the shape `writeAdminAudit`
      // produces — two spellings of an audit row is how one of them quietly stops
      // matching a query.
      tx.set(
        db.collection('admin_audit').doc(),
        adminAuditDoc({
          actorUid: actor.uid,
          actorEmail: actor.email,
          action: 'OVERRIDE_LOCKED_SPREAD',
          targetType: 'nfl_game',
          targetId: gameId,
          metadata: {
            overrideId, shape, reason,
            oldValue: previous ? previous.value : null,
            newValue: value,
            slate: `${game.season}/${game.seasonType}/${game.week}`,
          },
          status: 'success',
        }),
      );

      return { shape, previousValue: previous ? previous.value : null };
    });

    console.log(`[spreadOverride] ${result.shape} ${gameId} -> ${value} (override ${overrideId}).`);
    // The rescore is NOT enqueued here. The trigger below owns it, because the
    // trigger covers EVERY writer and this callable covers exactly one — routing
    // the enqueue through the callable would leave a console write changing the
    // canonical grading input with standings left stale, which is a REGRESSION
    // against the behaviour this plan inherited (codex round 3 on the revision).
    return { success: true, overrideId, ...result };
}

/** Auth and shape stay in the wrapper; the write path above is driven by tests. */
export const overrideLockedSpread = validated(
  { schema: overrideLockedSpreadSchema, label: 'overrideLockedSpread', role: 'SUPER_ADMIN', appCheck: 'monitor' },
  async (input, request) =>
    overrideLockedSpreadInternal(
      admin.firestore(),
      { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined },
      input,
    ),
);

/**
 * 2.4 — the detector, and the rescore handoff, on the collection the canonical
 * line now lives in.
 *
 * ⚠️ A TRIGGER, NOT A CALLABLE STEP, and that distinction is the whole point.
 * `nflSpreadRescoreTrigger`'s own header says it: *"it is the only mechanism that
 * covers EVERY writer"*. Under Revision 1 the canonical value moved, so this
 * trigger moved with it. `retry: true` is what makes the handoff durable — if the
 * queue write fails transiently and the handler resolves anyway, the affected ATS
 * standings stay wrong permanently with nobody told.
 *
 * `onDocumentWritten` rather than `onDocumentUpdated`: a CREATE changes the
 * canonical value (before it existed, readers fell back to `nfl_games.spread`) and
 * a DELETE changes it back. Both need the handoff, and a delete has no `after`
 * document at all — the slate key exists only in `before` (codex round 6 on the
 * revision).
 */
export async function handleFrozenSpreadChange(
  db: admin.firestore.Firestore,
  ev: { gameId: string; eventId: string; before?: FrozenSpread; after?: FrozenSpread },
): Promise<void> {
    const { before, after, gameId } = ev;
    const event = { id: ev.eventId };

    const verdict = classifyFrozenChange(before, after);
    if (verdict.kind === 'noop') return;

    // From `after` when there is one, from `before` on a delete.
    const key = after ?? before;
    const slate = slateFieldsOf(key);

    if (!slate) {
      // Alert rather than silently returning: without a slate key the rescore
      // cannot be enqueued, and this is exactly the credential-bypass variant the
      // plan expects — a record whose slate was mangled or a delete of one that
      // never carried it.
      const noted = await writeAdminAudit({
        actorUid: 'system',
        action: 'FROZEN_SPREAD_SLATE_KEY_MISSING',
        targetType: 'nfl_game',
        targetId: gameId,
        metadata: { kind: verdict.kind, season: key?.season ?? null, seasonType: key?.seasonType ?? null, week: key?.week ?? null },
        status: 'error',
      }, { id: `frozen-slate-${event.id}` });
      console.error(`[frozenSpread] ${gameId}: ${verdict.kind} with no usable slate key; NOT enqueued.`);
      // `writeAdminAudit` swallows its own failures and RETURNS whether the record
      // landed. This handler's entire job on this branch is to leave that record,
      // so resolving on a lost write means the alert never existed and `retry`
      // never fires. The deterministic id makes the redelivery a no-op overwrite.
      if (!noted) throw new Error(`[frozenSpread] slate-key alert for ${gameId} was not written; retrying.`);
      return;
    }
    const { season, seasonType, week } = slate;

    let auditWritten = true;
    if (!verdict.approved) {
      // Deterministic id, because a trigger is delivered at-least-once and an
      // auto-id append from a retry is an indistinguishable duplicate.
      auditWritten = await writeAdminAudit({
        actorUid: 'system',
        action: 'UNAPPROVED_FROZEN_SPREAD_CHANGE',
        targetType: 'nfl_game',
        targetId: gameId,
        metadata: {
          kind: verdict.kind,
          detail: verdict.reason,
          slate: `${season}/${seasonType}/${week}`,
          oldValue: before?.value ?? null,
          newValue: after?.value ?? null,
          source: after?.source ?? null,
        },
        status: 'error',
      }, { id: `frozen-unapproved-${event.id}` });
      console.warn(`[frozenSpread] UNAPPROVED change on ${gameId}: ${verdict.reason}`);
    }

    const ok = await enqueueRescore(db, {
      season, seasonType, week, reason: 'spread', enqueuedAt: Date.now(),
    });
    if (!ok) throw new Error(`[frozenSpread] enqueue failed for ${season}/${seasonType}/wk${week}; retrying.`);
    console.log(`[frozenSpread] ${verdict.kind} on ${gameId} (${verdict.reason}); enqueued ${season}/${seasonType}/wk${week}.`);

    // A LOST AUDIT ROW IS A FAILED RUN (codex r2 on this PR). `writeAdminAudit`
    // catches its own errors and returns whether the record landed; ignoring that
    // means an unauthorised change to a frozen line permanently has no forensic
    // record, on the one path whose entire purpose is to leave one. Thrown AFTER
    // the enqueue so the standings repair either way, and both writes are
    // idempotent under redelivery — the audit id is deterministic and the drain
    // groups queue events by slate.
    if (!auditWritten) {
      throw new Error(`[frozenSpread] unapproved-change audit for ${gameId} was not written; retrying.`);
    }
}

export const nflFrozenSpreadTrigger = onDocumentWritten(
  { document: `${FROZEN_SPREADS_COLLECTION}/{gameId}`, retry: true },
  async (event) =>
    handleFrozenSpreadChange(admin.firestore(), {
      gameId: event.params.gameId,
      eventId: event.id,
      before: event.data?.before?.exists ? (event.data.before.data() as FrozenSpread) : undefined,
      after: event.data?.after?.exists ? (event.data.after.data() as FrozenSpread) : undefined,
    }),
);
