import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { SITE, isSocialCrawler, extractPoolId, buildJoinPreviewHtml } from "./joinPreview.helpers";

const db = admin.firestore();

// Cache the SPA shell in the warm instance so human visits don't re-fetch it
// every time. Refreshed at most once a minute (index.html changes on deploy).
let spaCache: { html: string; at: number } | null = null;

// Firebase Hosting rewrites /join/** here. Social crawlers get a per-pool Open
// Graph preview; humans and search engines get the SPA shell (React Router
// handles /join/:id, and <RouteSEO> marks it noindex).
export const joinPreview = onRequest({ timeoutSeconds: 15, memory: "256MiB" }, async (req, res) => {
    const poolId = extractPoolId(req.path);

    if (isSocialCrawler(req.headers["user-agent"]) && poolId) {
        let name: string | undefined;
        let type: string | undefined;
        try {
            const doc = await db.collection("pools").doc(poolId).get();
            if (doc.exists) {
                const p = doc.data() as any;
                name = p?.name;
                type = p?.type;
            }
        } catch {
            // Fall through to a generic preview if the read fails.
        }
        res.set("Cache-Control", "public, max-age=300, s-maxage=600");
        res.status(200).send(buildJoinPreviewHtml({ poolId, name, type }));
        return;
    }

    try {
        const now = Date.now();
        if (!spaCache || now - spaCache.at > 60_000) {
            const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "www.marchmeleepools.com";
            const resp = await fetch(`https://${host}/index.html`);
            spaCache = { html: await resp.text(), at: now };
        }
        res.set("Cache-Control", "no-store");
        res.status(200).send(spaCache.html);
    } catch {
        res.redirect(302, `${SITE}/?pool=${encodeURIComponent(poolId)}`);
    }
});
