import { renderEmailHtml, escapeHtml } from "../emailStyles";
import { joinNames, type PoolSettlement } from "../shared/settlement";

/** The settlement email (PLAN-SPLIT-POT-SETTLEMENT §2.2 step 10). It says only what the record knows. */
export function settlementEmail(poolName: string, s: PoolSettlement): { subject: string; html: string } {
    const names = escapeHtml(joinNames(s.winnerNames));
    const solo = s.winnerNames.length === 1;
    const subject = solo ? `${poolName} is over — we have a winner` : `${poolName} is over — the pot was split`;
    const week = s.throughWeek !== null ? ` after week ${s.throughWeek}` : "";
    const lines = [
        // One survivor is a winner, not a split (qodo re-review of #715).
        solo
            ? `<p><strong>${escapeHtml(poolName)}</strong> is over${week}. <strong>${names}</strong> is the last player standing and wins 1st place${s.prizePerEntry !== null ? `, $${s.prizePerEntry}` : ""}.</p>`
            : `<p><strong>${escapeHtml(poolName)}</strong> is over${week}. The remaining players agreed to split the pot: <strong>${names}</strong>.</p>`,
        solo ? "" : s.prizePerEntry !== null
            ? `<p>Each of them is recorded as sharing 1st place, $${s.prizePerEntry} each.</p>`
            : `<p>Each of them is recorded as sharing 1st place.</p>`,
        s.rebuyDuesExcluded > 0
            ? `<p>$${s.rebuyDuesExcluded} of rebuy dues are not included in the recorded prize.</p>`
            : "",
        s.note ? `<p><strong>Note from the commissioner:</strong> ${escapeHtml(s.note)}</p>` : "",
        `<p>No more picks can be made in this pool. Money is settled between the commissioner and the players.</p>`,
    ];
    return { subject, html: renderEmailHtml("Pool Settled", lines.filter(Boolean).join("\n")) };
}
