import { validated } from "./lib/validated";
import { logAdminActionSchema } from "./schemas/adminSingles";
import { writeAdminAudit } from "./lib/adminAudit";

/**
 * logAdminAction (T7) — lets the consolidated Operations panel record an
 * admin_audit entry after invoking an operation whose own callable doesn't
 * yet write one. SUPER_ADMIN only; the client cannot write admin_audit
 * directly (rules: write:false), so this is the audited path.
 *
 * This is a convenience trail (client-reported action name/result summary),
 * NOT an authorization boundary — the underlying op callables enforce their
 * own SUPER_ADMIN checks.
 */
export const logAdminAction = validated(
  { schema: logAdminActionSchema, label: "logAdminAction", role: "SUPER_ADMIN", appCheck: "monitor" },
  async ({ action, targetType, targetId, metadata, status, error }, request) => {
  await writeAdminAudit({
    actorUid: request.auth!.uid,
    actorEmail: request.auth!.token.email as string | undefined,
    action,
    targetType,
    targetId,
    metadata,
    status: status === "error" ? "error" : "success",
    error,
  });
  return { success: true };
  },
);
