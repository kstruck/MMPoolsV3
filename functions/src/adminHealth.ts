import { onSchedule } from "firebase-functions/v2/scheduler";
import { ESPN_SITE_API } from './lib/espnHost';
import * as admin from "firebase-admin";
import { validated } from "./lib/validated";
import { getAdminHealthSnapshotSchema } from "./schemas/noInputAdmin";
import {
  withHeartbeat,
  findStaleJobs,
  HEARTBEAT_DOC,
  SCHEDULED_JOB_EXPECTATIONS,
  type HeartbeatVerdict,
  type JobHeartbeat,
  type StaleJob,
} from "./lib/heartbeat";
import { dispatchOpsAlert, type OpsAlertInput, type OpsAlertOutcome } from "./lib/opsAlertDispatcher";

/**
 * Real platform health for the Super-Admin Overview. Replaces the previously
 * hardcoded "API Status Center" card (which always showed OPERATIONAL / A+ /
 * fixed latencies). SUPER_ADMIN only — it does live network + Firestore probes.
 */

type Check = { ok: boolean; latencyMs: number; detail: string };

const NFL_SCOREBOARD =
  `${ESPN_SITE_API}/football/nfl/scoreboard`;

async function timed(fn: () => Promise<string>): Promise<Check> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - started, detail };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : "error",
    };
  }
}

async function checkEspn(): Promise<Check> {
  return timed(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(NFL_SCOREBOARD, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { events?: unknown[] };
      return `${body.events?.length ?? 0} events`;
    } finally {
      clearTimeout(t);
    }
  });
}

async function checkFirestore(db: admin.firestore.Firestore): Promise<Check> {
  return timed(async () => {
    // Cheap, always-present read: the public system/config flag doc.
    const snap = await db.collection("system").doc("config").get();
    return snap.exists ? "config read" : "config missing";
  });
}

/**
 * AI request volume, last 24h, across every pool (PLAN-COST-CONTROLS 0.5.5).
 * Interim spend visibility until Phase 6's cost card exists: each ai_requests
 * doc triggers a Gemini generation, so this count IS the AI spend driver, and a
 * spike is the thing an operator needs to see before an invoice tells them.
 *
 * ⚠️ Needs the `ai_requests.createdAt` COLLECTION_GROUP field override in
 * firestore.indexes.json, and `--only firestore:indexes` is a THIRD deploy
 * surface that neither the functions nor the rules deploy ships. An undeclared
 * index here would throw 9 FAILED_PRECONDITION on every run and report nothing
 * — exactly how enforceBillingStatus stayed broken for its whole life.
 *
 * `.count()` is an aggregation query: billed per read-unit, not per matched
 * document, so this stays cheap as volume grows.
 *
 * ⚠️ THIS PROBE NEVER REPORTS `ok: false`, and that is deliberate. The Overview
 * card derives its whole verdict from `checks.every(c => c.ok)`
 * (`SuperAdminBentoDashboard.tsx:164`), so a missing index or a transient query
 * error here would print "Degradation detected" over a platform that is
 * completely healthy. This is TELEMETRY, not an availability check: when it
 * cannot answer it says so in its detail and stays green. That is the same
 * crying-wolf failure this repo has rejected findings over before — a monitor
 * that is wrong in the alarming direction gets ignored, and then the real
 * outage is ignored with it. (An earlier draft of this function had a comment
 * claiming this behaviour while `timed()` did the opposite; codex round 4.)
 */
export async function checkAiVolume(db: admin.firestore.Firestore): Promise<Check> {
  const started = Date.now();
  try {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const agg = await db
      .collectionGroup("ai_requests")
      .where("createdAt", ">=", since)
      .count()
      .get();
    return {
      ok: true,
      latencyMs: Date.now() - started,
      detail: `${agg.data().count} AI requests last 24h`,
    };
  } catch (err) {
    // Says "unavailable" rather than inventing a number — the repo's own rule
    // ("Data unavailable → the card shows 'unavailable', never a
    // plausible-looking substitute"). A 0 here would read as "no AI spend",
    // which is exactly the wrong thing to believe when the probe is broken.
    const reason = err instanceof Error ? err.message : "error";
    console.warn("[adminHealth] AI volume probe failed (reported as unavailable, not as an outage)", err);
    return {
      ok: true,
      latencyMs: Date.now() - started,
      detail: `AI volume unavailable: ${reason}`,
    };
  }
}

/**
 * Email delivery health via the Trigger-Email extension's `delivery.state`
 * field on recent /mail docs. `delivery` is written by the extension, not our
 * app (sendEmail only writes to/message/createdAt), so it's an EXTERNAL
 * contract — read it defensively and fall back to a "were docs processed"
 * proxy when the field shape isn't present.
 */
async function checkEmail(db: admin.firestore.Firestore): Promise<Check> {
  return timed(async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const snap = await db
      .collection("mail")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    if (snap.empty) return "no mail last 24h";

    let errored = 0;
    let processing = 0;
    let hasDeliveryField = false;
    let stuck = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as {
        createdAt?: FirebaseFirestore.Timestamp | number;
        delivery?: { state?: string };
      };
      const state = data.delivery?.state;
      if (state !== undefined) {
        hasDeliveryField = true;
        if (state === "ERROR") errored++;
        else if (state === "PROCESSING" || state === "PENDING") processing++;
      } else {
        // Fallback: a doc with no delivery field created >10 min ago is stuck
        // (extension normally stamps delivery within seconds).
        const createdMs =
          typeof data.createdAt === "number"
            ? data.createdAt
            : data.createdAt?.toMillis?.() ?? 0;
        if (createdMs > since && Date.now() - createdMs > 10 * 60 * 1000) stuck++;
      }
    }

    if (hasDeliveryField) {
      if (errored > 0) throw new Error(`${errored} delivery errors (last 50)`);
      return `${processing} processing, 0 errors (last 50)`;
    }
    // No extension delivery field at all — report the proxy instead of faking.
    if (stuck > 0) throw new Error(`${stuck} unprocessed >10m (no delivery field)`);
    return `${snap.size} queued, no delivery field (unverified)`;
  });
}

export type HealthSnapshot = {
  at: number;
  checks: Record<string, { label: string; ok: boolean; latencyMs: number; detail: string }>;
};

/**
 * Pure health probe — runs the ESPN/Firestore/email/functions checks and
 * returns a snapshot. Shared by the SUPER_ADMIN callable AND the hourly
 * scheduler (a scheduler can't invoke the auth-gated onCall directly).
 */
export async function computeAdminHealthSnapshot(
  db: admin.firestore.Firestore
): Promise<HealthSnapshot> {
  const functionStarted = Date.now();
  const [espn, firestore, email, aiVolume] = await Promise.all([
    checkEspn(),
    checkFirestore(db),
    checkEmail(db),
    checkAiVolume(db),
  ]);
  return {
    at: Date.now(),
    checks: {
      espn: { label: "ESPN NFL API", ...espn },
      firestore: { label: "Firestore", ...firestore },
      email: { label: "Email delivery", ...email },
      aiVolume: { label: "AI request volume", ...aiVolume },
      functions: {
        label: "Cloud Functions",
        ok: true,
        latencyMs: Date.now() - functionStarted,
        detail: "handler responded",
      },
    },
  };
}

const HEALTH_DOC = "health/latest";
const HISTORY_CAP = 24; // ~1 day of hourly points, bounded in-doc (no TTL infra).

type HealthDoc = {
  latest?: HealthSnapshot;
  history?: HealthSnapshot[];
  alerts?: HealthAlertState;
};

/**
 * Persist a snapshot to the single admin-only health/latest doc: newest snapshot
 * + a bounded history array. functions-only write / SUPER_ADMIN read (firestore.rules).
 *
 * ⚠️ `{ merge: true }` is REQUIRED, not stylistic. The alert state below lives in
 * the same doc, and this write also runs from the SUPER_ADMIN "Run Check" button.
 * A full overwrite would let one manual click erase every "already paged" mark,
 * so the next hourly run would re-page every condition that is still failing —
 * turning the manual probe into a way to spam the pager.
 */
async function persistSnapshot(
  db: admin.firestore.Firestore,
  snapshot: HealthSnapshot,
  existing?: HealthDoc
): Promise<void> {
  const ref = db.doc(HEALTH_DOC);
  const doc = existing ?? ((await ref.get()).data() as HealthDoc | undefined);
  const history = [...(doc?.history ?? []), snapshot].slice(-HISTORY_CAP);
  await ref.set({ latest: snapshot, history, updatedAt: snapshot.at }, { merge: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Transition-only ops alerting (availability audit #2 / error-tracking 21c)
//
// The gap this closes: the hourly probe wrote its verdict to a doc nobody looks
// at between incidents. ESPN could be down, email delivery erroring, or a money
// -adjacent scheduled job dead for a week, and the ONLY way to find out was for
// an admin to open the Overview card and read it.
//
// The naive fix — page whenever something is failing — was rejected in review,
// twice, for two different reasons, and both rejections are load-bearing here:
//
//  1. `findStaleJobs` reports the SAME entry every single hour until the job
//     recovers, and a failing check likewise. Paging on state rather than on
//     CHANGE means an outage that lasts a weekend sends ~60 identical pages, and
//     a pager that repeats itself is one that gets muted — which is how the next
//     real page gets missed. So the current condition set is diffed against the
//     previous snapshot and only the NEW entries page.
//
//  2. `dispatchOpsAlert` swallows its own delivery failures and returns
//     `"failed"` rather than throwing. Marking a condition "alerted" and then
//     discovering the send failed would mean the page never goes out AT ALL —
//     the transition is spent, and the next run sees no change. So the mark is
//     written only on a `"sent"` outcome, and an undelivered page is retried on
//     the next run up to a bounded number of attempts.
//
// A continuing failure therefore stays visible in health/latest (`latest.checks`
// and the `alerts.alerted` list) while being OFF the pager. Recovery clears the
// key, so a recurrence is a fresh transition and pages again.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bounded retries for an undelivered page. After this many consecutive
 * non-`"sent"` outcomes for one condition the retries stop: the pager itself is
 * broken (or unconfigured), and hammering it hourly forever adds nothing that
 * `alerts.attempts` in the doc does not already say. The condition stays
 * abandoned until it clears, then re-arms.
 */
export const MAX_ALERT_ATTEMPTS = 3;

export interface HealthAlertState {
  /** Conditions already paged for (or abandoned after MAX_ALERT_ATTEMPTS). */
  alerted: string[];
  /** Condition → consecutive undelivered dispatch attempts. */
  attempts: Record<string, number>;
}

export interface HealthAlertPlan {
  /** Newly-appeared conditions: these page. */
  toDispatch: string[];
  /** Still failing, already paged — a continuation, not a transition. */
  alreadyAlerted: string[];
  /** Undelivered MAX_ALERT_ATTEMPTS times; no further retries while it persists. */
  abandoned: string[];
  /** Cleared since the previous run — state dropped so a recurrence re-pages. */
  recovered: string[];
  carriedAlerted: string[];
  carriedAttempts: Record<string, number>;
}

/**
 * Diff the current failing-condition set against the previous one. Pure, so the
 * property that actually matters — "the second hour of the same outage does not
 * page" — is a unit test rather than something discovered from Kevin's inbox.
 */
export function planHealthAlerts(
  prev: HealthAlertState | undefined,
  currentKeys: string[],
  maxAttempts: number = MAX_ALERT_ATTEMPTS,
): HealthAlertPlan {
  const current = [...new Set(currentKeys)].sort();
  const currentSet = new Set(current);
  const prevAlerted = new Set(prev?.alerted ?? []);
  const prevAttempts = prev?.attempts ?? {};

  const toDispatch: string[] = [];
  const alreadyAlerted: string[] = [];
  const abandoned: string[] = [];
  const carriedAttempts: Record<string, number> = {};

  for (const key of current) {
    const attempts = prevAttempts[key] ?? 0;
    if (attempts > 0) carriedAttempts[key] = attempts;
    if (prevAlerted.has(key)) {
      alreadyAlerted.push(key);
    } else if (attempts >= maxAttempts) {
      abandoned.push(key);
    } else {
      toDispatch.push(key);
    }
  }

  const recovered = [...new Set([...prevAlerted, ...Object.keys(prevAttempts)])]
    .filter((k) => !currentSet.has(k))
    .sort();

  return {
    toDispatch,
    alreadyAlerted,
    abandoned,
    recovered,
    // Only conditions that are STILL failing carry forward. A recovered key is
    // forgotten entirely — that is what makes a recurrence a new transition.
    carriedAlerted: [...prevAlerted].filter((k) => currentSet.has(k)).sort(),
    carriedAttempts,
  };
}

/**
 * Fold this run's dispatch outcomes into the next persisted state.
 *
 * ONLY `"sent"` marks a condition alerted. `"failed"` (pager broken) and
 * `"no-recipients"` (pager unconfigured) both count as an attempt and leave the
 * condition un-marked, so the next run tries again — the whole point of design
 * note 2 above. A dispatched key with no recorded outcome is treated as
 * undelivered for the same reason: the safe direction is to retry, never to
 * assume a page landed.
 */
export function applyDispatchOutcomes(
  plan: HealthAlertPlan,
  outcomes: Record<string, OpsAlertOutcome>,
  maxAttempts: number = MAX_ALERT_ATTEMPTS,
): HealthAlertState {
  const alerted = new Set(plan.carriedAlerted);
  const attempts: Record<string, number> = { ...plan.carriedAttempts };

  // Conditions whose retries were abandoned stay pinned at the cap, so they are
  // not retried again next hour but are still listed as known-failing.
  for (const key of plan.abandoned) {
    attempts[key] = Math.max(attempts[key] ?? 0, maxAttempts);
    alerted.add(key);
  }

  for (const key of plan.toDispatch) {
    if (outcomes[key] === "sent") {
      alerted.add(key);
      delete attempts[key];
    } else {
      attempts[key] = (attempts[key] ?? 0) + 1;
    }
  }

  return { alerted: [...alerted].sort(), attempts };
}

/** `check:<name>` for every probe currently reporting ok:false. */
export function failingCheckKeys(snapshot: HealthSnapshot): string[] {
  return Object.entries(snapshot.checks)
    .filter(([, c]) => c.ok === false)
    .map(([name]) => `check:${name}`);
}

/**
 * `job:<name>:<reason>` for every stale job. The reason is part of the key on
 * purpose: `never-ran` → `failing` is a genuinely different condition needing a
 * different fix, so it earns its own page rather than hiding behind the first one.
 */
export function staleJobKeys(stale: StaleJob[]): string[] {
  return stale.map((s) => `job:${s.jobName}:${s.reason}`);
}

/** Human-readable page for one condition key. */
function buildAlertInput(
  key: string,
  snapshot: HealthSnapshot,
  staleByKey: Map<string, StaleJob>,
): OpsAlertInput {
  if (key.startsWith("check:")) {
    const name = key.slice("check:".length);
    const check = snapshot.checks[name];
    return {
      type: "HEALTH_CHECK_FAILED",
      title: `Health check failing — ${check?.label ?? name}`,
      message:
        `The hourly platform health check just started reporting ${check?.label ?? name} as DOWN.\n` +
        `Detail: ${check?.detail ?? "(none)"}`,
      context: { check: name, latencyMs: check?.latencyMs ?? -1, detail: check?.detail ?? "" },
    };
  }
  const stale = staleByKey.get(key);
  const jobName = stale?.jobName ?? key;
  return {
    type: "SCHEDULED_JOB_STALE",
    title: `Scheduled job ${stale?.reason ?? "stale"} — ${jobName}`,
    message:
      `${jobName} is ${stale?.reason ?? "stale"}.\n` +
      `Last completed run: ${stale?.ageMinutes === null || stale?.ageMinutes === undefined
        ? "never"
        : `${stale.ageMinutes} minute(s) ago`}.` +
      (stale?.error ? `\nLast error: ${stale.error}` : ""),
    context: {
      job: jobName,
      reason: stale?.reason ?? "unknown",
      ageMinutes: stale?.ageMinutes ?? "never",
      ...(stale?.error ? { error: stale.error } : {}),
    },
  };
}

/**
 * Read heartbeats for the staleness half of the condition set.
 *
 * `null` means the read FAILED, which is NOT the same as "no job has ever run".
 * `findStaleJobs({})` reports the entire fleet as `never-ran`, so treating a
 * transient read error as an empty doc would page once per job — a false
 * all-hands incident caused by the monitor, not the system. Same distinction
 * opsHealth.ts already makes for the same reason.
 */
async function readHeartbeats(
  db: admin.firestore.Firestore,
): Promise<Record<string, JobHeartbeat | undefined> | null> {
  try {
    return ((await db.doc(HEARTBEAT_DOC).get()).data() ?? {}) as Record<string, JobHeartbeat | undefined>;
  } catch (e) {
    console.error("[adminHealth] heartbeat read failed; job staleness not evaluated this run:", e);
    return null;
  }
}

/**
 * Page for transitions, persist the resulting state, and report a heartbeat
 * verdict. Returns the verdict so an undelivered page marks the RUN unhealthy —
 * without that, "we detected an outage and told nobody" would stamp a green beat,
 * which is the exact silent-success mode heartbeatVerdicts.ts exists to prevent.
 */
async function alertOnHealthTransitions(
  db: admin.firestore.Firestore,
  snapshot: HealthSnapshot,
  prev: HealthAlertState | undefined,
): Promise<HeartbeatVerdict> {
  const heartbeats = await readHeartbeats(db);
  const stale = heartbeats === null ? [] : findStaleJobs(heartbeats, SCHEDULED_JOB_EXPECTATIONS, Date.now());
  const staleByKey = new Map(stale.map((s) => [`job:${s.jobName}:${s.reason}`, s]));

  // When heartbeats are unreadable the job half of the condition set is UNKNOWN,
  // so the previous job keys are carried forward verbatim. Dropping them would
  // read as "every stale job recovered" and re-page all of them the moment the
  // read succeeded again.
  const carriedJobKeys =
    heartbeats === null ? (prev?.alerted ?? []).filter((k) => k.startsWith("job:")) : staleJobKeys(stale);
  const carriedJobAttempts =
    heartbeats === null ? Object.keys(prev?.attempts ?? {}).filter((k) => k.startsWith("job:")) : [];

  const currentKeys = [...failingCheckKeys(snapshot), ...carriedJobKeys, ...carriedJobAttempts];
  const planned = planHealthAlerts(prev, currentKeys);

  // A job key carried through an unreadable heartbeat read has no StaleJob
  // behind it this run, so there is nothing truthful to put in the page. Defer
  // it rather than sending a content-free alert: it keeps its attempt count and
  // is reconsidered the next time the read succeeds.
  const plan: HealthAlertPlan = {
    ...planned,
    toDispatch: planned.toDispatch.filter((k) => k.startsWith("check:") || staleByKey.has(k)),
  };

  const outcomes: Record<string, OpsAlertOutcome> = {};
  for (const key of plan.toDispatch) {
    outcomes[key] = await dispatchOpsAlert(db, buildAlertInput(key, snapshot, staleByKey));
  }
  const next = applyDispatchOutcomes(plan, outcomes);
  await db.doc(HEALTH_DOC).set({ alerts: next }, { merge: true });

  const undelivered = plan.toDispatch.filter((k) => outcomes[k] !== "sent");
  const detail = {
    failing: currentKeys.length,
    paged: plan.toDispatch.length - undelivered.length,
    continuing: plan.alreadyAlerted.length,
    recovered: plan.recovered.length,
    heartbeatsReadable: heartbeats !== null,
  };
  return undelivered.length > 0
    ? {
        ok: false,
        error: `${undelivered.length} ops page(s) undelivered: ${undelivered.join(", ").slice(0, 200)}`,
        detail,
      }
    : { detail };
}

export const getAdminHealthSnapshot = validated(
  { schema: getAdminHealthSnapshotSchema, label: "getAdminHealthSnapshot", role: "SUPER_ADMIN", appCheck: "monitor" },
  async () => {
  const db = admin.firestore();
  const snapshot = await computeAdminHealthSnapshot(db);
  // Manual "Run Check" writes the same store the UI history reads, so the
  // last-run timestamp is never stale after a manual probe.
  await persistSnapshot(db, snapshot);
  return snapshot;
  },
);

/**
 * Hourly automated health probe → persists to health/latest so the Overview
 * API Status Center shows real, recent status without a manual click, keeps a
 * short rolling history, AND pages ops when a condition CHANGES (see the
 * transition-alerting block above).
 *
 * The alerting deliberately hangs off the scheduled run only, never off the
 * SUPER_ADMIN callable: `getAdminHealthSnapshot` is an operator clicking "Run
 * Check" while already looking at the card, so paging them would be telling
 * someone what they can see, and worse, would let a click storm drive the pager.
 */
export const scheduledHealthCheck = onSchedule("every 60 minutes", withHeartbeat('scheduledHealthCheck', async () => {
  const db = admin.firestore();
  const snapshot = await computeAdminHealthSnapshot(db);
  // One read serves both the history append and the previous alert state.
  const existing = (await db.doc(HEALTH_DOC).get()).data() as HealthDoc | undefined;
  await persistSnapshot(db, snapshot, existing);
  // Alerting must never take the probe down with it: a failure here would lose
  // the snapshot's own value (the card, the history) on top of the page.
  try {
    return await alertOnHealthTransitions(db, snapshot, existing?.alerts);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[adminHealth] transition alerting failed:", e);
    return { ok: false, error: `health alerting failed: ${message.slice(0, 300)}` };
  }
}));
