import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { getUnsubSecret, verifyUnsubToken, emailHash, getPrefs, EMAIL_CATEGORIES, EmailCategory, EmailCategoryPrefs } from "./emailPrefs";

/**
 * Email preference center — the tokenized link in every email footer
 * ({{UNSUB_URL}}) lands here. GET renders per-category checkboxes plus an
 * "unsubscribe from all" option; the form POSTs back to this same endpoint
 * with the e/t token pair carried in hidden fields. No client JS.
 *
 * Storage (email_optouts/{emailHash}):
 *   - { email, optedOutAt }                  → Phase-1 full opt-out (blocks all non-transactional)
 *   - { email, categories: {x: bool}, ... }  → per-category prefs (false = opted out)
 */

const CATEGORY_LABELS: Record<EmailCategory, { title: string; desc: string }> = {
    reminders: { title: "Reminders", desc: "Pool lock countdowns, pick deadlines, and payment reminders" },
    results: { title: "Results", desc: "Winner announcements, recaps, and post-game summaries" },
    announcements: { title: "Announcements", desc: "Commissioner broadcasts, waitlist openings, and invites" },
};

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const page = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px;">
<div style="max-width:460px; width:100%; background:#1e293b; border-radius:16px; padding:40px 32px;">
<h1 style="font-size:20px; margin:0 0 12px; text-align:center;">${title}</h1>
${body}
</div></body></html>`;

const messagePage = (title: string, text: string) =>
    page(title, `<p style="font-size:14px; color:#94a3b8; line-height:1.6; margin:0; text-align:center;">${text}</p>`);

function renderForm(email: string, token: string, prefs: { optedOutAll: boolean; categories: EmailCategoryPrefs }): string {
    const safeEmail = escapeHtml(email);
    const safeToken = escapeHtml(token);

    const rows = EMAIL_CATEGORIES.map((cat) => {
        // Checked = subscribed. Full opt-out unchecks everything; otherwise a
        // category is subscribed unless explicitly set to false.
        const subscribed = !prefs.optedOutAll && prefs.categories[cat] !== false;
        return `<label style="display:flex; gap:12px; align-items:flex-start; padding:12px; background:#0f172a; border-radius:10px; margin-bottom:10px; cursor:pointer;">
<input type="checkbox" name="${cat}" value="on"${subscribed ? " checked" : ""} style="margin-top:3px; accent-color:#6366f1; width:16px; height:16px;">
<span><strong style="font-size:14px; color:#e2e8f0;">${CATEGORY_LABELS[cat].title}</strong><br>
<span style="font-size:12px; color:#94a3b8; line-height:1.5;">${CATEGORY_LABELS[cat].desc}</span></span>
</label>`;
    }).join("\n");

    return page("Email preferences", `
<p style="font-size:13px; color:#94a3b8; text-align:center; margin:0 0 20px;">Choose which emails <strong style="color:#e2e8f0;">${safeEmail}</strong> receives from March Melee Pools. Transactional emails (receipts, security notices) are always delivered.</p>
<form method="POST">
<input type="hidden" name="e" value="${safeEmail}">
<input type="hidden" name="t" value="${safeToken}">
${rows}
<label style="display:flex; gap:12px; align-items:flex-start; padding:12px; background:#450a0a; border:1px solid #7f1d1d; border-radius:10px; margin:16px 0; cursor:pointer;">
<input type="checkbox" name="all" value="on"${prefs.optedOutAll ? " checked" : ""} style="margin-top:3px; accent-color:#ef4444; width:16px; height:16px;">
<span><strong style="font-size:14px; color:#fecaca;">Unsubscribe from all</strong><br>
<span style="font-size:12px; color:#fca5a5; line-height:1.5;">Stop all non-transactional email. Overrides the choices above.</span></span>
</label>
<button type="submit" style="width:100%; background:#6366f1; color:#fff; border:none; border-radius:10px; padding:12px; font-size:15px; font-weight:700; cursor:pointer;">Save preferences</button>
</form>`);
}

export const manageEmailPrefs = onRequest({ timeoutSeconds: 15, memory: "256MiB" }, async (req, res) => {
    const db = admin.firestore();

    const source = req.method === "POST" ? (req.body ?? {}) : req.query;
    const email = String(source.e ?? "").trim().toLowerCase();
    const token = String(source.t ?? "");

    if (!email || !token || !email.includes("@")) {
        res.status(400).send(messagePage("Invalid link", "This preferences link is malformed. Please use the link from a recent email."));
        return;
    }

    const secret = await getUnsubSecret(db);
    if (!verifyUnsubToken(email, token, secret)) {
        res.status(403).send(messagePage("Invalid link", "This preferences link is invalid or has been tampered with. Please use the link from a recent email."));
        return;
    }

    if (req.method === "GET") {
        const prefs = await getPrefs(db, email);
        res.status(200).send(renderForm(email, token, prefs));
        return;
    }

    if (req.method !== "POST") {
        res.status(405).send(messagePage("Not allowed", "Unsupported request method."));
        return;
    }

    const ref = db.collection("email_optouts").doc(emailHash(email));

    if (source.all === "on") {
        // Full opt-out — write the Phase-1 shape (no categories map) so both
        // isOptedOut() and the legacy unsubscribe flow treat it as block-all.
        await ref.set({
            email,
            optedOutAt: FieldValue.serverTimestamp(),
        });
        res.status(200).send(messagePage(
            "You're unsubscribed",
            `${escapeHtml(email)} will no longer receive emails from March Melee Pools. Note: your pool commissioner may still contact you directly about money owed or won. Changed your mind? Use this page again to re-subscribe.`
        ));
        return;
    }

    // Per-category prefs. A plain set() (no merge) clears any previous
    // optedOutAt, so saving categories also acts as "re-subscribe".
    const categories: EmailCategoryPrefs = {};
    for (const cat of EMAIL_CATEGORIES) {
        categories[cat] = source[cat] === "on";
    }
    await ref.set({
        email,
        categories,
        updatedAt: FieldValue.serverTimestamp(),
    });

    const subscribed = EMAIL_CATEGORIES.filter((c) => categories[c]).map((c) => CATEGORY_LABELS[c].title);
    res.status(200).send(messagePage(
        "Preferences saved",
        subscribed.length > 0
            ? `${escapeHtml(email)} will receive: ${subscribed.join(", ")}. Transactional emails are always delivered. You can change this anytime via the link in any email footer.`
            : `${escapeHtml(email)} is opted out of all email categories. Transactional emails are still delivered. You can change this anytime via the link in any email footer.`
    ));
});
