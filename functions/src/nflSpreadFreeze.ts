// The weekly spread freeze — the IO (PLAN-NFL-SPREAD-FREEZE Phase 1, Revision 1).
//
// Kevin, 2026-08-19: *"It is important that the spreads for each pool lock at a
// specified day and time… once the spreads are fetched for that week, they must
// be locked and remain unchanged no matter what."*
//
// At Tuesday 09:00 ET this fetches the target week's lines FROM ESPN AT THAT
// INSTANT and writes them, all or nothing, into `nfl_frozen_spreads` — a
// collection no client can write. What it replaces (`lockSpreadsOnce`) fetched
// nothing: it read whatever the last import had left lying around and flipped a
// flag. Measured in prod on 2026-08-18 it locked 0 spreads while ESPN carried all
// sixteen lines, because the 5-minute sync's window is `startTime <= now + 2h` and
// a game three days out is invisible to the only thing that fetches lines.
//
// ⚠️ THE JOB KEEPS ITS DEPLOYED NAME, `lockNFLSpreadsJob`, ON PURPOSE. Renaming a
// v2 scheduled function replaces the Cloud Scheduler job and starts the heartbeat
// history over, and the config key `system/config.nflSpreadLock` is already armed
// in production. The name is now narrower than what the job does; renaming it is a
// separate, trivially reviewable change and is NOT worth bundling into the change
// that alters what it writes.
//
// SAFETY (Rule 1, mmp-change-control): kill-switch
// `system/config.nflSpreadLock.enabled === true` required (default OFF,
// fail-safe); dry-run by default (`dryRun !== false`) — it fetches, selects and
// reports the sixteen values it WOULD write, and writes nothing.
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { withHeartbeat, configReadFailedVerdict } from './lib/heartbeat';
import { validated } from './lib/validated';
import { runNFLSpreadFreezeSchema } from './schemas/nflPools';
import { readJobGate, fetchNFLWeekSchedule } from './nflSchedule';
import { FROZEN_SPREADS_COLLECTION, type FrozenSpread } from './shared/frozenSpread';
import {
  FREEZE_HORIZON_MS,
  chooseSlate,
  planFreeze,
  slateId,
  slateIsDue,
  slateKeysOf,
  type FetchedGame,
  type PlannedFreeze,
  type SlateKey,
  type StoredGame,
} from './lib/spreadFreeze';
import { acquireSlateLease, assertSlateFence, releaseSlateLease } from './lib/slateLease';

export interface FreezeResult {
  /** `season/seasonType/week`, or null when no slate was due. */
  slate: string | null;
  dryRun: boolean;
  /** Records actually written. 0 on a dry run, by design. */
  frozen: number;
  /** Records the run would write — equals `frozen` on a live run that succeeded. */
  wouldFreeze: number;
  ok: boolean;
  reason: string;
  /** The dry-run report: every value, and where it came from. */
  writes?: PlannedFreeze[];
  /** Stored games the fetch did not return. */
  missingFromFetch?: string[];
  /** Fetched games not stored on the slate. */
  unexpectedInFetch?: string[];
  /** Games with neither a feed line nor a stored working line. */
  noLine?: string[];
  /** Another freeze pass holds this slate's lease; nothing was written. */
  leaseBusy?: boolean;
}

type FetchWeek = (week: number, season: string, seasonType: 1 | 2 | 3) => Promise<FetchedGame[]>;

/** ESPN only publishes these three; anything else is a corrupt stored slate. */
const isFetchableSeasonType = (n: number): n is 1 | 2 | 3 => n === 1 || n === 2 || n === 3;

async function readSlate(db: admin.firestore.Firestore, key: SlateKey): Promise<StoredGame[]> {
  const snap = await db
    .collection('nfl_games')
    .where('season', '==', key.season)
    .where('seasonType', '==', key.seasonType)
    .where('week', '==', key.week)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id } as unknown as StoredGame));
}

/**
 * Does ANY frozen record exist for this slate?
 *
 * One game carrying a record makes the whole slate off-limits, permanently. The
 * original 1.1 asked whether a game carried `nfl_games.spread.frozenAt`, and
 * Revision 1 writes that marker nowhere near `nfl_games` — leaving the test that
 * way resurrected the round-7 re-freeze defect by moving the data (codex round 5
 * on the revision).
 */
async function slateAlreadyFrozen(db: admin.firestore.Firestore, key: SlateKey): Promise<boolean> {
  const snap = await db
    .collection(FROZEN_SPREADS_COLLECTION)
    .where('season', '==', key.season)
    .where('seasonType', '==', key.seasonType)
    .where('week', '==', key.week)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Freeze the slate that is due, or say why nothing was.
 *
 * The caller owns the kill-switch; this assumes it has been checked. Extracted
 * from the scheduler so the WRITE PATH is testable without one — the same reason
 * `lockSpreadsOnce` was extracted, and the reason it had any coverage at all.
 */
export async function freezeSlateOnce(
  db: admin.firestore.Firestore,
  now: number,
  opts: { dryRun: boolean; fetchWeek?: FetchWeek },
): Promise<FreezeResult> {
  const fetchWeek: FetchWeek = opts.fetchWeek ?? (fetchNFLWeekSchedule as unknown as FetchWeek);
  const idle = (reason: string): FreezeResult => ({
    slate: null, dryRun: opts.dryRun, frozen: 0, wouldFreeze: 0, ok: true, reason,
  });

  // 1.1 — candidates are the slates with a kickoff inside the freeze horizon.
  // The horizon is not decoration: without it, "the earliest slate with no frozen
  // record" walks forward to week N+1 and freezes it nine days early, at a Tuesday
  // that is not that week's stated cutoff, permanently (codex round 8).
  const windowSnap = await db
    .collection('nfl_games')
    .where('startTime', '>', now)
    .where('startTime', '<=', now + FREEZE_HORIZON_MS)
    .get();
  if (windowSnap.empty) return idle('no games kick off inside the freeze horizon');

  const candidates: { key: SlateKey; verdict: ReturnType<typeof slateIsDue> }[] = [];
  for (const key of slateKeysOf(windowSnap.docs.map((d) => d.data() as StoredGame))) {
    // The FULL stored slate, not the windowed subset: a slate is one thing that
    // freezes at one instant, and judging it by a partial view is how it ends up
    // frozen across two.
    const slate = await readSlate(db, key);
    candidates.push({ key, verdict: slateIsDue(slate, now, await slateAlreadyFrozen(db, key)) });
  }

  const chosen = chooseSlate(candidates);
  if (!chosen) {
    // The normal state of a Tuesday in February, and it says so rather than
    // returning a bare zero.
    const detail = candidates.map((c) => `${slateId(c.key)}: ${c.verdict.reason}`).join('; ');
    return idle(`no slate is due${detail ? ` (${detail})` : ''}`);
  }

  const key = chosen.key;
  const label = slateId(key);
  if (!isFetchableSeasonType(key.seasonType)) {
    return { slate: label, dryRun: opts.dryRun, frozen: 0, wouldFreeze: 0, ok: false,
      reason: `seasonType ${key.seasonType} is not a fetchable ESPN season type` };
  }

  // 1.3 — take the slate's lease for the WHOLE pass. The preflight reconciliation
  // below runs before the transaction, and Firestore does not range-lock, so an
  // importer write that adds a game in between would commit alongside it and leave
  // the newcomer unfrozen (codex round 11).
  const lease = await acquireSlateLease(db, key, now);
  if (!lease) {
    return { slate: label, dryRun: opts.dryRun, frozen: 0, wouldFreeze: 0, ok: true, leaseBusy: true,
      reason: `another pass holds the lease on ${label}; nothing was written` };
  }

  try {
    // Re-read the slate under the lease. Everything downstream reconciles against
    // THIS snapshot, and it is the first one taken with the importer locked out.
    const stored = await readSlate(db, key);

    // 1.2 — fetch at the instant. This is the whole point: the frozen number is
    // the number that was live at the stated time, not whatever the import caught.
    const fetched = await fetchWeek(key.week, key.season, key.seasonType);

    const plan = planFreeze(key, stored, fetched);
    if (!plan.ok) {
      console.warn(`[spreadFreeze] REFUSED ${label}: ${plan.reason}`, {
        missingFromFetch: plan.missingFromFetch, unexpectedInFetch: plan.unexpectedInFetch, noLine: plan.noLine,
      });
      return {
        slate: label, dryRun: opts.dryRun, frozen: 0, wouldFreeze: 0, ok: false, reason: plan.reason,
        missingFromFetch: plan.missingFromFetch, unexpectedInFetch: plan.unexpectedInFetch, noLine: plan.noLine,
      };
    }

    if (opts.dryRun) {
      console.log(
        `[spreadFreeze] DRY-RUN ${label}: would freeze ${plan.writes.length} line(s): ` +
          plan.writes.map((w) => `${w.gameId}=${w.value}(${w.from})`).join(', '),
      );
      return { slate: label, dryRun: true, frozen: 0, wouldFreeze: plan.writes.length, ok: true,
        reason: `dry run — would freeze ${plan.writes.length} line(s)`, writes: plan.writes };
    }

    const frozenAt = now;
    await db.runTransaction(async (tx) => {
      // Reads first, all of them: Firestore refuses a read after a write in a
      // transaction.
      await assertSlateFence(tx, db, key, lease, Date.now());
      const refs = plan.writes.map((w) => db.collection(FROZEN_SPREADS_COLLECTION).doc(w.gameId));
      const existing = await tx.getAll(...refs);

      // 1.4's belt to 1.1's braces. Selection should already have excluded this
      // slate; re-reading inside the transaction is what makes "a spread is
      // written once and then only overridden" true of the CODE rather than only
      // of the selection rule.
      const already = existing.filter((s) => s.exists).map((s) => s.id);
      if (already.length > 0) {
        throw new Error(
          `ALREADY_FROZEN: ${already.length} game(s) on ${label} already carry a frozen record (${already.slice(0, 5).join(', ')}); refusing to re-freeze.`,
        );
      }

      for (const w of plan.writes) {
        const record: FrozenSpread = {
          gameId: w.gameId,
          value: w.value,
          frozenAt,
          season: key.season,
          seasonType: key.seasonType,
          week: key.week,
          // Every writer declares itself. The rescore trigger judges approval PER
          // SOURCE, and a record with no `source` is filed as an unapproved change
          // — which on a normal freeze would be all sixteen games, every week
          // (codex rounds 6-8 on the revision).
          source: 'freeze',
        };
        tx.create(db.collection(FROZEN_SPREADS_COLLECTION).doc(w.gameId), record);
      }
    });

    console.log(`[spreadFreeze] froze ${plan.writes.length} line(s) for ${label} at ${new Date(frozenAt).toISOString()}.`);
    return { slate: label, dryRun: false, frozen: plan.writes.length, wouldFreeze: plan.writes.length, ok: true,
      reason: `froze ${plan.writes.length} line(s)`, writes: plan.writes };
  } finally {
    // Best-effort: a failed release only means the lease expires on its own TTL,
    // which is what the expiry is for. Throwing here would mask the real error.
    await releaseSlateLease(db, key, lease).catch((e) => {
      console.warn(`[spreadFreeze] lease release failed for ${label}:`, e);
    });
  }
}

async function readFreezeGate(db: admin.firestore.Firestore) {
  const cfg = (await db.doc('system/config').get()).data()?.nflSpreadLock as
    | { enabled?: boolean; dryRun?: boolean }
    | undefined;
  return readJobGate(cfg);
}

/**
 * 1.6 — the stated day and time: Tuesday 09:00 ET. If it ever moves it moves
 * deliberately and members are told, because the whole point is that they can
 * predict it.
 */
export const lockNFLSpreadsJob = onSchedule(
  { schedule: '0 9 * * 2', timeZone: 'America/New_York' },
  withHeartbeat('lockNFLSpreadsJob', async () => {
    const db = admin.firestore();

    let gate = { enabled: false, dryRun: true };
    let configError: unknown = null;
    try {
      gate = await readFreezeGate(db);
    } catch (e) {
      configError = e ?? new Error('unknown config read error');
    }
    if (configError) return configReadFailedVerdict('lockNFLSpreadsJob', configError);
    if (!gate.enabled) {
      console.log('[spreadFreeze] disabled (system/config.nflSpreadLock.enabled !== true); nothing to do.');
      return { detail: { enabled: false } };
    }

    const result = await freezeSlateOnce(db, Date.now(), { dryRun: gate.dryRun });
    // A refusal is the outage about to happen, not a quiet skip: the job runs
    // WEEKLY, so "the next run picks it up" is seven days later, past kickoff for
    // everything it left behind. `nflLockWatchJob` pages independently; this is
    // what puts it in the heartbeat too.
    return result.ok
      ? { detail: { ...result, dryRun: gate.dryRun } }
      : { ok: false, error: result.reason, detail: { ...result, dryRun: gate.dryRun } };
  }),
);

/**
 * 1.5b — the manual invocation, because a Tuesday-only schedule cannot rehearse
 * itself (codex round 14).
 *
 * The rollout asks operators to read dry-run reports on Saturday, Sunday and
 * Monday from a job that runs on none of those days; as written the preflight was
 * unrunnable. This also becomes the on-demand re-run when a Tuesday pass refuses
 * — a missing line, a lease clash — and the hook an end-to-end test drives.
 *
 * ⚠️ TWO GATES, AND BOTH MUST SAY LIVE — a deliberate narrowing of the plan.
 * 1.5b says *"`dryRun` defaults to the config value; passing `false` explicitly is
 * what makes a manual live freeze deliberate"*, and those two clauses contradict
 * each other: if it defaults to the config value then omitting it ALSO runs live
 * the moment the config is armed, so passing `false` is not what makes anything
 * deliberate. Resolved toward the house rule (`mmp-change-control` Rule 1):
 * **`dryRun` defaults TRUE at the schema layer, and the config can always hold it
 * dry but never force it live.** A live manual freeze therefore needs the config
 * armed AND an explicit `dryRun: false`, which is what the second clause was
 * asking for. Recorded in the plan rather than diverged from silently.
 */
export const runNFLSpreadFreeze = validated(
  { schema: runNFLSpreadFreezeSchema, label: 'runNFLSpreadFreeze', role: 'SUPER_ADMIN', appCheck: 'monitor' },
  async (input) => {
    const db = admin.firestore();
    const gate = await readFreezeGate(db);
    if (!gate.enabled) {
      return {
        enabled: false, ok: false, slate: null, dryRun: true, frozen: 0, wouldFreeze: 0,
        reason: 'The freeze is disabled. Set system/config.nflSpreadLock.enabled = true to run it.',
      };
    }
    const dryRun = gate.dryRun || input.dryRun; // schema default TRUE; the config can only make it drier
    return { enabled: true, ...(await freezeSlateOnce(db, Date.now(), { dryRun })) };
  },
);
