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

async function loadCostControls(): Promise<CostControlsConfig | null> {
    try {
        const snap = await admin.firestore().collection("system").doc("config").get();
        if (!snap.exists) return null;
        const raw = snap.data() as { costControls?: CostControlsConfig } | undefined;
        return raw?.costControls ?? null;
    } catch (e) {
        // Fail CLOSED: an unreadable config denies optional paid work.
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
