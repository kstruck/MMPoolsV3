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
    const raw = data?.addons;
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return ADDON_KEYS.reduce((acc, k) => {
        acc[k] = src[k] === true;
        return acc;
    }, {} as Record<string, boolean>);
}
