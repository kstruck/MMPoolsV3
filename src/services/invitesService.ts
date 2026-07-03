import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// Bulk email invites (UX overhaul Phase 3.7). Kept out of dbService so the
// invite feature stays self-contained; errors propagate to the caller, which
// renders them via getUserMessage (same pattern as the callable wrappers in
// dbService that rethrow for the component to handle).

export interface SendPoolInvitesResult {
    sent: number;
    skipped: number;
    invalid: number;
}

export const invitesService = {
    /**
     * Email pool invitations to a list of addresses. Backend enforces
     * owner/manager permission, a 50-address batch cap, and a 24h per-address
     * rate limit (rate-limited addresses come back in `skipped`).
     */
    sendPoolInvites: async (
        poolId: string,
        emails: string[],
        personalNote?: string
    ): Promise<SendPoolInvitesResult> => {
        const fn = httpsCallable<
            { poolId: string; emails: string[]; personalNote?: string },
            SendPoolInvitesResult
        >(functions, "sendPoolInvites");
        const result = await fn({ poolId, emails, personalNote: personalNote?.trim() || undefined });
        return result.data;
    },
};
