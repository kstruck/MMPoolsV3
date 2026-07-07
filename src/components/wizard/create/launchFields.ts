import { ADDON_KEYS, type AddonSelection } from '@shared/schemas/quote';

// Shared helper: pull the launch/billing inputs the SERVER's computeLaunchMode
// reads out of a create payload (functions/src/poolOps.ts estimatedPlayersFromPayload
// + payloadHasPaidAddon). The wizard collects these on the LaunchStep; every
// build*Payload spreads the result at the TOP LEVEL of the create payload so the
// callable sees `estimatedPlayers` and `addons.*` and stamps free vs trial
// correctly. The client NEVER decides free/trial — it only feeds these fields.
//
// - estimatedPlayers: a positive integer, or omitted when the commissioner left
//   it blank/0 (server then treats "no estimate" as free, unchanged behavior).
// - addons: the four premium-feature booleans, all defaulting to false. Always
//   present so a partial selection is unambiguous.
export function readLaunchFields(values: Record<string, unknown>): {
  estimatedPlayers?: number;
  addons: AddonSelection;
} {
  const v = values as Record<string, any>;

  const rawEstimate = Number(v.estimatedPlayers);
  const estimatedPlayers =
    Number.isFinite(rawEstimate) && rawEstimate > 0 ? Math.floor(rawEstimate) : undefined;

  const src = (v.addons && typeof v.addons === 'object' ? v.addons : {}) as Record<string, unknown>;
  const addons = ADDON_KEYS.reduce((acc, key) => {
    acc[key] = src[key] === true;
    return acc;
  }, {} as Record<string, boolean>) as AddonSelection;

  return { estimatedPlayers, addons };
}
