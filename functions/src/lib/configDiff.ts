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
    if (typeof v === 'string') return '[string]';
    if (Array.isArray(v)) return `[array:${v.length}]`;
    if (typeof v === 'object') {
        return Object.fromEntries(
            Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactConfigValue(x)]),
        );
    }
    return '[value]';
}

export function diffTopLevel(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): Record<string, ConfigKeyChange> {
    const changed: Record<string, ConfigKeyChange> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const b = before[key] === undefined ? null : before[key];
        const a = after[key] === undefined ? null : after[key];
        if (JSON.stringify(b) !== JSON.stringify(a)) {
            changed[key] = { from: b, to: a };
        }
    }
    return changed;
}
