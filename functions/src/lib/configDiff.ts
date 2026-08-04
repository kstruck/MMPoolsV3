/**
 * Shallow top-level diff of two Firestore doc snapshots' data, built for the
 * system/config audit trail. PURE — no firebase imports — so the guard is
 * unit-testable and mutation-testable without an emulator.
 *
 * Values are compared by JSON identity: system/config holds only plain maps,
 * booleans and numbers (poolTypeFlags, maintenanceMode, job gates), and a
 * JSON compare treats key-order-stable rewrites of the same value as
 * unchanged, which is exactly what "nothing actually changed" should mean for
 * an audit line.
 */
/** Sentinel for "this key did not exist on this side" — distinct from an
 * explicit Firestore null, which is a real value. */
export const ABSENT = '[absent]';

export interface ConfigKeyChange {
    from: unknown;
    to: unknown;
}

/**
 * Redact a config value for the audit record. Kill-switch fidelity without
 * PII: booleans, numbers and null pass through untouched (they ARE the
 * record for flags and job gates); strings are masked — system/config
 * carries ops-alert email/SMS recipients, and a raw string in an immutable
 * audit doc is a leak, not a log; arrays report length only; objects
 * recurse per key so `{enabled: true, notifyEmail: "..."}` audits as
 * `{enabled: true, notifyEmail: "[string]"}`.
 */
export function redactConfigValue(v: unknown): unknown {
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
    // The diff's ABSENT sentinel is a string on purpose (it must survive JSON)
    // and must NOT be masked to '[string]' — losing it makes an add and a
    // value-change indistinguishable in the record (qodo #362 r1 #1).
    if (v === ABSENT) return v;
    if (typeof v === 'string') return '[string]';
    // Primitive elements survive (liveSeasonTypes: [1] -> [1,2] must read as
    // exactly that — a length-only marker hid same-length edits entirely,
    // qodo #362 r1 #2); string elements are masked like any other string.
    if (Array.isArray(v)) {
        const MAX = 20;
        const shown = v.slice(0, MAX).map(redactConfigValue);
        return v.length > MAX ? [...shown, `[+${v.length - MAX} more]`] : shown;
    }
    if (typeof v === 'object') {
        return Object.fromEntries(
            Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactConfigValue(x)]),
        );
    }
    return '[value]';
}

/**
 * JSON with one repair: JSON.stringify renders NaN and ±Infinity as "null",
 * which both silences NaN->null diffs (codex r5) and writes a misleading
 * "null" into the persisted record (codex r8). Non-finite numbers are tagged
 * so they compare — and READ — as themselves. Exported for the trigger's
 * metadata serialization; fingerprint() is the comparison alias.
 */
export function auditStringify(v: unknown): string {
    return JSON.stringify(v, (_k, x) =>
        typeof x === 'number' && !Number.isFinite(x) ? `[num:${String(x)}]` : x,
    ) ?? 'undefined';
}

function fingerprint(v: unknown): string {
    return auditStringify(v);
}

export function diffTopLevel(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): Record<string, ConfigKeyChange> {
    // Null prototype: config field names are attacker-adjacent input, and a
    // key like __proto__ misbehaves on a plain object (qodo #362 r1 #5).
    const changed: Record<string, ConfigKeyChange> = Object.create(null);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        // Presence-aware: an explicit Firestore null is a VALUE, and absent-vs-null
        // must diff — normalizing both to null made adding or deleting a
        // null-valued key invisible to the very trigger built to see it
        // (codex r3). The record carries the ABSENT sentinel for the missing
        // side so the audit line reads as an add/remove, not a null->null.
        const inB = key in before && before[key] !== undefined;
        const inA = key in after && after[key] !== undefined;
        if (inB !== inA) {
            changed[key] = { from: inB ? before[key] : ABSENT, to: inA ? after[key] : ABSENT };
            continue;
        }
        if (inB && fingerprint(before[key]) !== fingerprint(after[key])) {
            changed[key] = { from: before[key], to: after[key] };
        }
    }
    return changed;
}

/**
 * Narrow an object-to-object change to only the sub-keys that differ, one
 * level deep. A whole-map from/to for poolTypeFlags serializes past
 * capMetadata's 200-char string truncation and can cut the changed flag out
 * of its own audit line (codex r2); after narrowing, the record carries
 * exactly the flags that moved. Non-object changes pass through untouched.
 */
export function narrowChange(change: ConfigKeyChange): ConfigKeyChange {
    const { from, to } = change;
    const isPlainObj = (x: unknown): x is Record<string, unknown> =>
        x !== null && typeof x === 'object' && !Array.isArray(x);
    if (!isPlainObj(from) || !isPlainObj(to)) return change;
    const sub = diffTopLevel(from, to);
    const narrowedFrom: Record<string, unknown> = Object.create(null);
    const narrowedTo: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(sub)) {
        narrowedFrom[k] = sub[k].from;
        narrowedTo[k] = sub[k].to;
    }
    return { from: narrowedFrom, to: narrowedTo };
}
