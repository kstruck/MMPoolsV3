/**
 * Cost-control config reader (PLAN-COST-CONTROLS.md Phase 0.4/0.5).
 *
 * ⚠️ POLARITY IS THE POINT — this module FAILS CLOSED, and that is the opposite
 * of `lib/systemGuards.ts`, which fails OPEN on purpose ("a config-read failure
 * must never block legitimate actions"). Do not consolidate the two readers.
 * For an OPTIONAL PAID feature, inaction is the safe state: a Firestore outage
 * must never be able to turn spend ON. For pool creation and joins, inaction is
 * the harmful state. Same shaped read, opposite correct default.
 *
 * Stripe checkout and webhooks are deliberately NOT behind this config — a
 * config read error must never disable payment processing (plan §Key decisions).
 *
 * One config home: everything lives under `system/config.costControls`. Do not
 * add a second location (the settings/billing_config vs config/billing_config
 * split-brain is the cautionary tale).
 */
import * as admin from "firebase-admin";

/** Audience of an SMS send. The kill-switch blocks `'member'` ONLY (D4). */
export type SmsAudience = 'member' | 'security' | 'test';

export interface CostControlsConfig {
    ai?: {
        enabled?: boolean;
        model?: string;
        monthlyCapUSD?: number;
        perPoolMonthlyCapUSD?: number;
        perUserPoolHourly?: number;
        perUserPoolDaily?: number;
        perPoolDaily?: number;
        perPoolMonthly?: number;
    };
    sms?: { enabled?: boolean };
    alerts?: { thresholds?: number[] };
}

/**
 * Process-level cache with a short TTL (codex round 5).
 *
 * WHY: `sendCourierSMS` consults the switch on EVERY send, and the reminder
 * passes call it once per recipient in a loop — so an uncached read meant one
 * `system/config` get per member per run. Spending N Firestore reads to check a
 * cost-control switch is the sort of thing this plan exists to stop.
 *
 * THE TRADEOFF, stated plainly: flipping the switch in the Firestore console
 * takes up to TTL_MS to take effect on an already-warm instance. That is
 * acceptable for THIS switch — it turns a feature off for a period, it is not
 * an emergency stop mid-incident — and 60s is short enough that a human
 * flipping a flag and then watching for the effect will not be confused. If a
 * future switch needs immediate effect, read it uncached rather than shortening
 * this for everyone.
 *
 * Failures are NOT cached: a Firestore blip must not pin the answer to
 * fail-closed for a minute after it recovers.
 */
const TTL_MS = 60_000;
let cached: { at: number; value: CostControlsConfig | null } | null = null;

/** Test seam — drops the cache so a test can change the config mid-run. */
export function __resetCostControlsCache(): void {
    cached = null;
}

async function loadCostControls(): Promise<CostControlsConfig | null> {
    const now = Date.now();
    if (cached && now - cached.at < TTL_MS) return cached.value;
    try {
        const snap = await admin.firestore().collection("system").doc("config").get();
        const raw = snap.exists
            ? (snap.data() as { costControls?: CostControlsConfig } | undefined)
            : undefined;
        const value = raw?.costControls ?? null;
        cached = { at: now, value };
        return value;
    } catch (e) {
        // Fail CLOSED: an unreadable config denies optional paid work. Not
        // cached — see above.
        console.warn("[costControls] config read failed; treating paid features as disabled", e);
        return null;
    }
}

/**
 * True only when `costControls.sms.enabled === true` is explicitly present.
 * Missing config, missing block, missing field, or a read error all deny —
 * so the switch defaults OFF, which is where Kevin wants SMS today (D3/D4).
 */
export async function isMemberSmsEnabled(): Promise<boolean> {
    const cfg = await loadCostControls();
    return cfg?.sms?.enabled === true;
}
