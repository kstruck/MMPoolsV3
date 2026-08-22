import { onSchedule } from "firebase-functions/v2/scheduler";
import { ESPN_SITE_API } from './lib/espnHost';
import * as admin from "firebase-admin";
import { validated } from "./lib/validated";
import { getAdminHealthSnapshotSchema } from "./schemas/noInputAdmin";
import { withHeartbeat } from "./lib/heartbeat";

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

/**
 * Persist a snapshot to the single admin-only health/latest doc: newest snapshot
 * + a bounded history array. functions-only write / SUPER_ADMIN read (firestore.rules).
 */
async function persistSnapshot(
  db: admin.firestore.Firestore,
  snapshot: HealthSnapshot
): Promise<void> {
  const ref = db.doc(HEALTH_DOC);
  const existing = (await ref.get()).data() as { history?: HealthSnapshot[] } | undefined;
  const history = [...(existing?.history ?? []), snapshot].slice(-HISTORY_CAP);
  await ref.set({ latest: snapshot, history, updatedAt: snapshot.at });
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
 * API Status Center shows real, recent status without a manual click, and keeps
 * a short rolling history.
 */
export const scheduledHealthCheck = onSchedule("every 60 minutes", withHeartbeat('scheduledHealthCheck', async () => {
  const db = admin.firestore();
  const snapshot = await computeAdminHealthSnapshot(db);
  await persistSnapshot(db, snapshot);
}));
