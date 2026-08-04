import * as logger from "firebase-functions/logger";
import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { writeAdminAudit, capMetadata } from "./lib/adminAudit";
import { diffTopLevel } from "./lib/configDiff";

/**
 * Audit trail for system/config — the doc that carries every kill-switch,
 * job gate, pool-type flag and maintenance toggle. Until this trigger,
 * flipping a flag (SuperAdmin UI writes the doc directly; console edits do
 * too) left NO admin_audit record: the 2026-08-04 E2E session toggled pool
 * creation on and off in prod and the audit log had nothing to show for it.
 *
 * A trigger rather than a callable so the trail covers EVERY writer —
 * UI, console, scripts — not just the paths that remember to log.
 * WithAuthContext so client writes carry the writer's uid.
 */
export const onSystemConfigWritten = onDocumentWrittenWithAuthContext(
    "system/config",
    async (event) => {
        const before = (event.data?.before?.data() ?? {}) as Record<string, unknown>;
        const after = (event.data?.after?.data() ?? {}) as Record<string, unknown>;

        const changed = diffTopLevel(before, after);
        const keys = Object.keys(changed);
        if (keys.length === 0) return;

        // One string per changed key so capMetadata's nested-object flattening
        // doesn't reduce every entry to "[object]" — the from→to is the record.
        const metadata = Object.fromEntries(
            keys.map((k) => [k, JSON.stringify(changed[k])]),
        );

        const written = await writeAdminAudit({
            actorUid: event.authId ?? "unknown",
            action: "SYSTEM_CONFIG_CHANGED",
            targetType: "system",
            targetId: "config",
            metadata: capMetadata(metadata),
            status: "success",
        });
        if (!written) {
            // writeAdminAudit swallows by design; this trigger's whole job is
            // the record, so at least leave a log-line trail of the loss.
            logger.error("[systemConfigAudit] audit write LOST for keys:", keys.join(","));
        }
    },
);
