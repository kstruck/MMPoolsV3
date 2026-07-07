/**
 * couponTemplates.ts (PLAN-BUYFLOW-OVERHAUL Phase 6 #23) — SUPER_ADMIN callables
 * for Coupon Templates (the saved, reusable coupon definitions the Monetization
 * tab mints real coupons from) plus a small acknowledge-alert callable (#22).
 *
 * Every mutating callable:
 *  - is SUPER_ADMIN-only via assertCallerRole (claim + user-doc must agree —
 *    the exact helper adminBillingOps uses; imported, not reinvented), and
 *  - records an admin_audit entry via writeAdminAudit.
 *
 * couponTemplates/{id} rules (Wave 5 owns firestore.rules): SUPER_ADMIN direct
 * client READ; ALL writes functions-only. These callables ARE those writes.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { assertCallerRole } from "./adminClaims";
import { writeAdminAudit } from "./lib/adminAudit";
import {
  couponTemplateInputSchema,
  couponFieldsFromTemplate,
  type CouponTemplateBody,
} from "./shared/schemas/couponTemplate";

/** Parse + validate a template payload; throws HttpsError(invalid-argument) on failure. */
function parseTemplateInput(data: unknown) {
  const parsed = couponTemplateInputSchema.safeParse(data);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new HttpsError("invalid-argument", `coupon template failed validation: ${summary}`);
  }
  return parsed.data;
}

/**
 * createCouponTemplate — persist a new couponTemplates/{id}. Doubles as the
 * "Save as template" action: the client passes the extracted fields of an
 * existing coupon (name/notes added) and this stores them.
 */
export const createCouponTemplate = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const input = parseTemplateInput(request.data);

  const now = Date.now();
  const ref = await admin.firestore().collection("couponTemplates").add({
    ...input,
    createdAt: now,
    updatedAt: now,
  });

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "COUPON_TEMPLATE_CREATE",
    targetType: "couponTemplate",
    targetId: ref.id,
    metadata: { name: input.name, discountType: input.discountType },
    status: "success",
  });
  return { success: true, templateId: ref.id };
});

/** updateCouponTemplate — overwrite an existing template's body (validated). */
export const updateCouponTemplate = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { templateId } = (request.data ?? {}) as { templateId?: string };
  if (!templateId || typeof templateId !== "string") {
    throw new HttpsError("invalid-argument", "templateId (string) is required.");
  }
  const input = parseTemplateInput((request.data as { template?: unknown })?.template ?? request.data);

  const ref = admin.firestore().collection("couponTemplates").doc(templateId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "couponTemplate not found.");
  }
  await ref.set({ ...input, updatedAt: Date.now() }, { merge: true });

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "COUPON_TEMPLATE_UPDATE",
    targetType: "couponTemplate",
    targetId: templateId,
    metadata: { name: input.name },
    status: "success",
  });
  return { success: true, templateId };
});

/** deleteCouponTemplate — remove a template. Minting real coupons is unaffected. */
export const deleteCouponTemplate = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { templateId } = (request.data ?? {}) as { templateId?: string };
  if (!templateId || typeof templateId !== "string") {
    throw new HttpsError("invalid-argument", "templateId (string) is required.");
  }
  await admin.firestore().collection("couponTemplates").doc(templateId).delete();

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "COUPON_TEMPLATE_DELETE",
    targetType: "couponTemplate",
    targetId: templateId,
    status: "success",
  });
  return { success: true };
});

/**
 * mintCouponFromTemplate — create a REAL coupon from a template. This replicates
 * the `adminManageCoupon` "create" write minimally (the same
 * `coupons.add({...fields, code: UPPER, createdAt})` shape) — adminBillingOps.ts
 * is out of this wave's edit scope, so the create path is faithfully mirrored
 * here rather than refactored. Counters (usesCount) start at 0 and the usageLog
 * is empty — a freshly minted coupon has zero uses.
 *
 * The `code` comes from the caller (a template has no code — the admin names the
 * new coupon at mint time). All other fields come from the template body.
 */
export const mintCouponFromTemplate = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { templateId, code } = (request.data ?? {}) as { templateId?: string; code?: string };
  if (!templateId || typeof templateId !== "string") {
    throw new HttpsError("invalid-argument", "templateId (string) is required.");
  }
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new HttpsError("invalid-argument", "a non-empty coupon code is required.");
  }

  const tplSnap = await admin.firestore().collection("couponTemplates").doc(templateId).get();
  if (!tplSnap.exists) {
    throw new HttpsError("not-found", "couponTemplate not found.");
  }
  const body = tplSnap.data() as CouponTemplateBody & { name?: string };

  const normalizedCode = code.trim().toUpperCase();

  // Replicate the adminManageCoupon create write shape exactly: coupon fields
  // from the template + normalized code + counters + createdAt.
  const couponFields = couponFieldsFromTemplate(body);
  const ref = await admin.firestore().collection("coupons").add({
    ...couponFields,
    code: normalizedCode,
    usesCount: 0,
    usageLog: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "COUPON_MINT_FROM_TEMPLATE",
    targetType: "coupon",
    targetId: ref.id,
    metadata: { templateId, code: normalizedCode },
    status: "success",
  });
  return { success: true, couponId: ref.id, code: normalizedCode };
});

/**
 * acknowledgeMonetizationAlert (PLAN #22) — flip a monetization_alerts doc from
 * open -> acked (or back to open). SUPER_ADMIN-only, audited. Works for BOTH the
 * coupon-abuse/housekeeping alerts this wave writes AND the Wave-2
 * refund/dispute/double-charge alerts (same collection, same status field).
 */
export const acknowledgeMonetizationAlert = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { alertId, status } = (request.data ?? {}) as {
    alertId?: string;
    status?: "acked" | "open";
  };
  if (!alertId || typeof alertId !== "string") {
    throw new HttpsError("invalid-argument", "alertId (string) is required.");
  }
  const nextStatus = status === "open" ? "open" : "acked";

  const ref = admin.firestore().collection("monetization_alerts").doc(alertId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "monetization alert not found.");
  }
  await ref.set(
    {
      status: nextStatus,
      acknowledgedBy: nextStatus === "acked" ? caller.uid : null,
      acknowledgedAt: nextStatus === "acked" ? Date.now() : null,
      updatedAt: Date.now(),
    },
    { merge: true }
  );

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "MONETIZATION_ALERT_ACK",
    targetType: "monetizationAlert",
    targetId: alertId,
    metadata: { status: nextStatus },
    status: "success",
  });
  return { success: true, status: nextStatus };
});
