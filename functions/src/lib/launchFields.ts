import { ADDON_KEYS } from "../shared/schemas/quote";

// Pure server-side mirror of the client's `readLaunchFields`
// (src/components/wizard/create/launchFields.ts). Kept free of firebase imports
// so it is unit-testable without standing up the Admin SDK.

/**
 * The four add-on booleans, normalized from a create payload
 * (PLAN-WIZARD-BUYFLOW-FIXES T3, codex r1 [P1]).
 *
 * `createPool` and `createNFLPool` spread the client payload, so their pools
 * already carry `addons`. `createBracketPool` builds its document field by field
 * and dropped it — so a bracket launch stored no record of what the
 * commissioner picked, and the upgrade page's seed had nothing to read. Only an
 * explicit `true` counts; this is a display/seed hint, never a price input
 * (pricing is `computeQuote`'s, always).
 */
export function normalizeAddonSelection(data: Record<string, unknown> | null | undefined): Record<string, boolean> {
    // ⚠️ Accepts BOTH payload shapes, exactly as `payloadHasPaidAddon` does
    // (codex r2 [P2] on T5): a top-level `addons` object, or the four flags as
    // siblings. `computeLaunchMode` reads the sibling shape and will put such a
    // create on a TRIAL — so if this read only `addons`, that pool would be a
    // trial with every entitlement locked, which is the defect T5 exists to
    // fix, restored for every non-wizard caller. When `addons` is present it
    // wins outright, again matching payloadHasPaidAddon.
    const raw = data?.addons;
    const src = (raw && typeof raw === 'object' ? raw : (data ?? {})) as Record<string, unknown>;
    return ADDON_KEYS.reduce((acc, k) => {
        acc[k] = src[k] === true;
        return acc;
    }, {} as Record<string, boolean>);
}
