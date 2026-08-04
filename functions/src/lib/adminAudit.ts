import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Admin Audit Log (T7). Top-level `admin_audit` collection keyed by actor —
 * forensic "what did admin X do" trail, distinct from the pool-scoped
 * pools/{id}/audit written by writeAuditEvent. Written only by Cloud Functions
 * (rules: write:false). See CONTEXT.md "Admin Audit Log".
 */

export type AdminAuditStatus = "success" | "error";

export interface AdminAuditEntry {
  actorUid: string;
  actorEmail?: string;
  action: string; // e.g. "ROLE_CHANGED", "POOL_CLOSED", "BACKFILL_RUN"
  targetType?: string; // e.g. "pool" | "user"
  targetId?: string;
  metadata?: Record<string, unknown>;
  status: AdminAuditStatus;
  error?: string;
}

const SECRET_KEY = /token|password|secret|apikey|api_key/i;

/**
 * Redact + size-cap a metadata object so audit docs never store raw
 * params/results (PII + doc-size risk). Secrets are dropped, long strings
 * truncated, and keys added only until the JSON stays under `maxBytes` (1KB).
 * Pure — unit-tested without firebase-admin.
 */
export function capMetadata(
  input: Record<string, unknown> | undefined,
  maxBytes = 1024
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    let val: unknown = v;
    if (SECRET_KEY.test(k)) {
      val = "[redacted]";
    } else if (typeof v === "string" && v.length > 200) {
      val = v.slice(0, 200) + "…";
    } else if (v !== null && typeof v === "object") {
      // Don't store nested blobs; keep a short marker instead.
      val = `[${Array.isArray(v) ? "array" : "object"}]`;
    }
    const candidate = { ...out, [k]: val };
    if (JSON.stringify(candidate).length > maxBytes) break;
    out[k] = val;
  }
  return out;
}

/**
 * Append one admin-audit entry. Never throws into the caller's happy path —
 * an audit-write failure is logged but must not fail the underlying action
 * (the action itself already succeeded/failed on its own terms).
 *
 * RETURNS whether the entry was actually written. Swallowing the failure is
 * still right, but a caller whose whole job is to leave a record — a scheduled
 * sweep, an alert path — needs to know the record was lost, or "audited" and
 * "silently didn't" stay indistinguishable. Callers that don't care may ignore it.
 */
export async function writeAdminAudit(
  entry: AdminAuditEntry,
  opts?: {
    /**
     * Deterministic document id. Triggers are delivered at-least-once, so an
     * auto-id `.add()` from a retried event appends an indistinguishable
     * duplicate record; passing the Firestore event id makes the retry a
     * no-op overwrite of the same doc (codex, systemConfigAudit r1).
     */
    id?: string;
  }
): Promise<boolean> {
  try {
    const db = admin.firestore();
    const coll = db.collection("admin_audit");
    const ref = opts?.id ? coll.doc(opts.id) : coll.doc();
    // Deterministic ids exist for at-least-once retries; create() makes the
    // retry a no-op instead of a set() that re-stamps `at` and shifts the
    // entry's position in the at-ordered log (qodo #362 r1 #3). The
    // ALREADY_EXISTS catch below treats a duplicate as success — the record
    // the caller wanted is there.
    const write = opts?.id ? ref.create.bind(ref) : ref.set.bind(ref);
    await write({
      actorUid: entry.actorUid,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: capMetadata(entry.metadata),
      status: entry.status,
      error: entry.error ? String(entry.error).slice(0, 300) : null,
      at: Timestamp.now(),
    });
    return true;
  } catch (e) {
    if (opts?.id && (e as { code?: number }).code === 6) {
      // ALREADY_EXISTS on a deterministic id: a retry found the first
      // attempt's record already in place. That IS success.
      return true;
    }
    console.error("[adminAudit] write failed (non-fatal):", e);
    return false;
  }
}
