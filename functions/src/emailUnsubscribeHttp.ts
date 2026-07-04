import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { getUnsubSecret, verifyUnsubToken, emailHash } from "./emailPrefs";

/** HTTP endpoint behind the unsubscribe link in every email footer. */

const page = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px;">
<div style="max-width:420px; text-align:center; background:#1e293b; border-radius:16px; padding:40px 32px;">
<h1 style="font-size:20px; margin:0 0 12px;">${title}</h1>
<p style="font-size:14px; color:#94a3b8; line-height:1.6; margin:0;">${body}</p>
</div></body></html>`;

export const emailUnsubscribe = onRequest({ timeoutSeconds: 15, memory: "256MiB" }, async (req, res) => {
    const db = admin.firestore();
    const email = String(req.query.e ?? "").trim().toLowerCase();
    const token = String(req.query.t ?? "");

    if (!email || !token || !email.includes("@")) {
        res.status(400).send(page("Invalid link", "This unsubscribe link is malformed. Please use the link from a recent email."));
        return;
    }

    const secret = await getUnsubSecret(db);
    if (!verifyUnsubToken(email, token, secret)) {
        res.status(403).send(page("Invalid link", "This unsubscribe link is invalid or has been tampered with. Please use the link from a recent email."));
        return;
    }

    await db.collection("email_optouts").doc(emailHash(email)).set({
        email,
        optedOutAt: FieldValue.serverTimestamp(),
    });

    res.status(200).send(page(
        "You're unsubscribed",
        `${email} will no longer receive emails from March Melee Pools. Note: your pool commissioner may still contact you directly about money owed or won. Changed your mind? Contact your commissioner or support to re-subscribe.`
    ));
});
