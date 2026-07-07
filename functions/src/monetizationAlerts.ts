import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { writeAdminAudit } from "./lib/adminAudit";
import { sendEmail } from "./reminders";
import {
  computeCouponAlerts,
  alertDedupeKey,
  isAbuseAlert,
  DEFAULT_VELOCITY_THRESHOLD,
  type AlertCandidate,
  type AlertCoupon,
  type MonetizationAlertType,
} from "./lib/monetizationAlertLogic";

/**
 * monetizationAlerts (PLAN-BUYFLOW-OVERHAUL Phase 6 #22) — a ~6-hourly sweep
 * that computes coupon-abuse + housekeeping alerts and writes/refreshes
 * `monetization_alerts` docs. The abuse alerts (velocity spike, new-account
 * cluster) also email the Super-Admin(s); housekeeping alerts (near-max,
 * expiring) stay dashboard-only.
 *
 * SAFETY, mirroring autoClosePools (T2) exactly:
 *  - Kill-switch: does nothing unless
 *    system/config.monetizationAlerts.enabled === true (default OFF). A
 *    missing/misread config is treated as disabled.
 *  - Dry-run by default (monetizationAlerts.dryRun !== false): it only REPORTS
 *    what it WOULD write (one admin_audit summary) and writes NO alert docs and
 *    sends NO email until an admin reviews reports and sets dryRun:false.
 *  - Config-read failure => disabled (fail-safe).
 *  - De-dupe: alert docs are keyed on (type,couponCode) so a re-run refreshes an
 *    existing OPEN alert instead of creating a duplicate. An already-acked alert
 *    for the same key is left alone (not resurrected) unless it re-trips after
 *    being acked — see the upsert logic below.
 *
 * All detection is delegated to the PURE functions in
 * lib/monetizationAlertLogic.ts (unit-tested); this file is only I/O + wiring.
 */

const COUPON_SCAN_LIMIT = 1000; // safety cap on coupons scanned per run
const USER_LOOKUP_LIMIT = 2000; // safety cap on user docs read for cluster detection

interface AlertsConfig {
  enabled: boolean;
  dryRun: boolean;
  velocityThreshold: number;
  notifyEmail?: string;
}

/** Read the kill-switch/dry-run/threshold config. Any error => disabled. */
async function readAlertsConfig(db: admin.firestore.Firestore): Promise<AlertsConfig> {
  const cfg: AlertsConfig = {
    enabled: false,
    dryRun: true,
    velocityThreshold: DEFAULT_VELOCITY_THRESHOLD,
    notifyEmail: undefined,
  };
  try {
    const raw = (await db.doc("system/config").get()).data()?.monetizationAlerts as
      | { enabled?: boolean; dryRun?: boolean; velocityThreshold?: number; notifyEmail?: string }
      | undefined;
    cfg.enabled = raw?.enabled === true;
    cfg.dryRun = raw?.dryRun !== false; // default true unless explicitly false
    if (typeof raw?.velocityThreshold === "number" && raw.velocityThreshold > 0) {
      cfg.velocityThreshold = raw.velocityThreshold;
    }
    if (typeof raw?.notifyEmail === "string" && raw.notifyEmail.includes("@")) {
      cfg.notifyEmail = raw.notifyEmail;
    }
  } catch (e) {
    console.warn("[monetizationAlerts] config read failed; staying disabled:", e);
  }
  return cfg;
}

/**
 * Collect the set of uids that appear in ANY coupon usageLog, then read those
 * user docs to map uid -> account createdAt (ms). Only fetches the uids we need
 * (batched by document id) so a large user base doesn't blow the read budget.
 */
async function loadAccountCreatedAt(
  db: admin.firestore.Firestore,
  coupons: AlertCoupon[]
): Promise<Record<string, number>> {
  const uids = new Set<string>();
  for (const c of coupons) {
    for (const e of c.usageLog ?? []) {
      if (e.userId && e.status !== "released") uids.add(e.userId);
    }
  }
  const out: Record<string, number> = {};
  const list = [...uids].slice(0, USER_LOOKUP_LIMIT);
  // Firestore getAll takes DocumentReferences; chunk to stay well within limits.
  const CHUNK = 300;
  for (let i = 0; i < list.length; i += CHUNK) {
    const refs = list.slice(i, i + CHUNK).map((uid) => db.doc(`users/${uid}`));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      const data = s.data();
      if (!data) continue;
      const created = normalizeMs(data.createdAt);
      if (typeof created === "number") out[s.id] = created;
    }
  }
  return out;
}

/** Coerce a Firestore Timestamp | number | ISO string into epoch ms (or undefined). */
function normalizeMs(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return undefined;
    }
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

/**
 * Upsert one alert candidate into monetization_alerts, deduped on
 * (type,couponCode). Semantics:
 *  - No existing doc          -> create (status 'open').
 *  - Existing doc, status open -> refresh message/detail/lastSeenAt (no dupe).
 *  - Existing doc, status acked -> re-open (the condition tripped again after
 *    acknowledgement — the admin should see it once more).
 * Returns 'created' | 'refreshed' | 'reopened' for the run summary.
 */
async function upsertAlert(
  db: admin.firestore.Firestore,
  candidate: AlertCandidate,
  nowMs: number
): Promise<"created" | "refreshed" | "reopened"> {
  const key = alertDedupeKey(candidate.type, candidate.couponCode);
  const ref = db.collection("monetization_alerts").doc(key);
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const base = {
      type: candidate.type,
      couponCode: candidate.couponCode,
      couponId: candidate.couponId ?? null,
      message: candidate.message,
      detail: candidate.detail,
      source: "monetizationAlerts",
      lastSeenAt: nowMs,
      updatedAt: nowMs,
    };
    if (!snap.exists) {
      txn.set(ref, { ...base, status: "open", createdAt: nowMs });
      return "created";
    }
    const prev = snap.data() as { status?: string } | undefined;
    if (prev?.status === "acked") {
      txn.set(ref, { ...base, status: "open", reopenedAt: nowMs }, { merge: true });
      return "reopened";
    }
    // status open (or anything else) -> refresh in place.
    txn.set(ref, { ...base, status: "open" }, { merge: true });
    return "refreshed";
  });
}

/** Resolve recipient emails for the abuse-alert notification. */
async function resolveNotifyRecipients(
  db: admin.firestore.Firestore,
  cfg: AlertsConfig
): Promise<string[]> {
  // Prefer an explicit configured address (cheap + predictable).
  if (cfg.notifyEmail) return [cfg.notifyEmail];
  // Fallback: email every SUPER_ADMIN.
  try {
    const snap = await db.collection("users").where("role", "==", "SUPER_ADMIN").limit(25).get();
    const emails = snap.docs
      .map((d) => (d.data()?.email as string | undefined) ?? "")
      .filter((e) => e.includes("@"));
    return [...new Set(emails)];
  } catch (e) {
    console.warn("[monetizationAlerts] SUPER_ADMIN lookup failed; no email recipients:", e);
    return [];
  }
}

function abuseEmailHtml(candidates: AlertCandidate[]): string {
  const rows = candidates
    .map(
      (c) =>
        `<li style="margin-bottom:8px"><strong>${escapeHtmlLite(c.type)}</strong> — ${escapeHtmlLite(
          c.message
        )}</li>`
    )
    .join("");
  return [
    `<div style="font-family:sans-serif;color:#111">`,
    `<h2>Coupon abuse alert${candidates.length > 1 ? "s" : ""}</h2>`,
    `<p>The monetization sweep flagged the following on the March Melee Pools platform:</p>`,
    `<ul>${rows}</ul>`,
    `<p>Review them in the Super-Admin → Monetization → Alerts tab. You can deactivate an offending coupon there in one click.</p>`,
    `</div>`,
  ].join("");
}

/** Minimal HTML escaping for the email body (coupon codes/messages are server-built but be safe). */
function escapeHtmlLite(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const monetizationAlerts = functions.scheduler.onSchedule(
  { schedule: "every 6 hours", timeoutSeconds: 300, memory: "512MiB" },
  async () => {
    const db = admin.firestore();
    const nowMs = Date.now();

    const cfg = await readAlertsConfig(db);
    if (!cfg.enabled) {
      console.log(
        "[monetizationAlerts] disabled (system/config.monetizationAlerts.enabled !== true); nothing to do."
      );
      return;
    }

    // Load coupons (the only collection the detectors scan).
    let coupons: AlertCoupon[] = [];
    try {
      const snap = await db.collection("coupons").limit(COUPON_SCAN_LIMIT).get();
      coupons = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AlertCoupon, "id">) }));
    } catch (e) {
      console.error("[monetizationAlerts] failed to read coupons; aborting run:", e);
      await writeAdminAudit({
        actorUid: "system",
        action: "MONETIZATION_ALERTS_SWEEP",
        targetType: "coupon",
        metadata: { error: "coupon read failed" },
        status: "error",
        error: String(e),
      });
      return;
    }

    const accountCreatedAtByUid = await loadAccountCreatedAt(db, coupons);

    // Compute all candidates via the pure logic.
    const allCandidates: AlertCandidate[] = [];
    for (const coupon of coupons) {
      const cands = computeCouponAlerts(coupon, nowMs, {
        velocityThreshold: cfg.velocityThreshold,
        accountCreatedAtByUid,
      });
      allCandidates.push(...cands);
    }

    const byType = allCandidates.reduce<Record<string, number>>((acc, c) => {
      acc[c.type] = (acc[c.type] ?? 0) + 1;
      return acc;
    }, {});
    const abuseCandidates = allCandidates.filter((c) => isAbuseAlert(c.type as MonetizationAlertType));

    if (cfg.dryRun) {
      console.log(
        `[monetizationAlerts] DRY-RUN: would write ${allCandidates.length} alert(s):`,
        byType
      );
      await writeAdminAudit({
        actorUid: "system",
        action: "MONETIZATION_ALERTS_SWEEP",
        targetType: "coupon",
        metadata: {
          dryRun: true,
          couponsScanned: coupons.length,
          wouldWrite: allCandidates.length,
          abuse: abuseCandidates.length,
          byType,
          sample: allCandidates.slice(0, 8).map((c) => `${c.type}:${c.couponCode}`).join(", "),
        },
        status: "success",
      });
      return;
    }

    // Live run: upsert every candidate (deduped), then email the abuse ones.
    let created = 0;
    let refreshed = 0;
    let reopened = 0;
    for (const c of allCandidates) {
      try {
        const res = await upsertAlert(db, c, nowMs);
        if (res === "created") created += 1;
        else if (res === "reopened") reopened += 1;
        else refreshed += 1;
      } catch (e) {
        console.error(`[monetizationAlerts] upsert failed for ${c.type}:${c.couponCode}:`, e);
      }
    }

    // Email the two abuse alert types only (velocity, new-account cluster).
    let emailedTo = 0;
    if (abuseCandidates.length > 0) {
      const recipients = await resolveNotifyRecipients(db, cfg);
      const html = abuseEmailHtml(abuseCandidates);
      const subject = `[MMP] ${abuseCandidates.length} coupon abuse alert${
        abuseCandidates.length > 1 ? "s" : ""
      }`;
      for (const to of recipients) {
        // category 'transactional' so it is never suppressed by marketing opt-out.
        await sendEmail(db, to, subject, html, {
          transactional: true,
          category: "transactional",
          reason: "coupon_abuse_alert",
        });
        emailedTo += 1;
      }
    }

    console.log(
      `[monetizationAlerts] wrote alerts (created ${created}, refreshed ${refreshed}, reopened ${reopened}); emailed ${emailedTo} recipient(s).`
    );
    await writeAdminAudit({
      actorUid: "system",
      action: "MONETIZATION_ALERTS_SWEEP",
      targetType: "coupon",
      metadata: {
        dryRun: false,
        couponsScanned: coupons.length,
        created,
        refreshed,
        reopened,
        abuse: abuseCandidates.length,
        emailedRecipients: emailedTo,
        byType,
      },
      status: "success",
    });
  }
);
