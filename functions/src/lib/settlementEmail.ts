import { renderEmailHtml, escapeHtml } from "../emailStyles";
import { joinNames, type PoolSettlement } from "../shared/settlement";

/** The settlement email (PLAN-SPLIT-POT-SETTLEMENT §2.2 step 10). It says only what the record knows. */
export function settlementEmail(poolName: string, s: PoolSettlement): { subject: string; html: string } {
    const names = escapeHtml(joinNames(s.winnerNames));
    const subject = `${poolName} is over — the pot was split`;
    const week = s.throughWeek !== null ? ` after week ${s.throughWeek}` : "";
    const lines = [
        `<p><strong>${escapeHtml(poolName)}</strong> is over${week}. The remaining players agreed to split the pot: <strong>${names}</strong>.</p>`,
        s.prizePerEntry !== null
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
