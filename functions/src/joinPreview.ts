import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { SITE, isSocialCrawler, extractPoolId, buildJoinPreviewHtml } from "./joinPreview.helpers";

const db = admin.firestore();

// Cache the SPA shell in the warm instance so human visits don't re-fetch it
// every time. Refreshed at most once a minute (index.html changes on deploy).
let spaCache: { html: string; at: number } | null = null;

// Resolve a pool by document id, then by slug — the app addresses pools by slug
// (dbService subscribeToPool queries urlSlug/slug), so /pool/:id is usually a slug.
async function resolvePool(poolId: string): Promise<{ name?: string; type?: string } | null> {
    const byId = await db.collection("pools").doc(poolId).get();
    if (byId.exists) return byId.data() as any;
    for (const field of ["urlSlug", "slug"]) {
        const snap = await db.collection("pools").where(field, "==", poolId).limit(1).get();
        if (!snap.empty) return snap.docs[0].data() as any;
    }
    return null;
}

// Firebase Hosting / nginx route shareable pool routes (/join/** and /pool/**)
// here. Social crawlers get a per-pool Open Graph preview; humans and search
// engines get the SPA shell (React Router handles the route; <RouteSEO> noindexes it).
export const joinPreview = onRequest({ timeoutSeconds: 15, memory: "256MiB" }, async (req, res) => {
    const poolId = extractPoolId(req.path);

    if (isSocialCrawler(req.headers["user-agent"]) && poolId) {
        let name: string | undefined;
        let type: string | undefined;
        try {
            const p = await resolvePool(poolId);
            if (p) { name = p.name; type = p.type; }
        } catch {
            // Fall through to a generic preview if the read fails.
        }
        res.set("Cache-Control", "public, max-age=300, s-maxage=600");
        res.status(200).send(buildJoinPreviewHtml({ poolId, name, type, path: req.path }));
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
