import { setGlobalOptions } from "firebase-functions/v2";

/**
 * Instance ceiling for every v2 function (2026-08-23 cloud audit: zero
 * maxInstances anywhere meant a retry storm or runaway loop could scale to the
 * project default with no cap — the repo has already seen deploy-time
 * `429 Quota exceeded`).
 *
 * 10 instances × the v2 default concurrency of 80 requests/instance = 800
 * concurrent requests per function — far above launch traffic. A function
 * that measurably needs more can override maxInstances inline.
 *
 * MUST stay the FIRST import in index.ts: setGlobalOptions only affects
 * functions defined after it runs, and ES modules evaluate in import order.
 * The three v1 triggers (userSync, announcements, participant) are not
 * covered by this — they carry their own runWith({ maxInstances }).
 */
setGlobalOptions({ maxInstances: 10 });
