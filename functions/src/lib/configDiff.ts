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
