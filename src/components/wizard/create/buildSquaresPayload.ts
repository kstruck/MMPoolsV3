import { writePaymentHandles, CLEAR } from '@shared/paymentHandles';

// Maps validated wizard values to the SQUARES pool payload for
// dbService.createPool. Fee is costPerSquare (top-level, not settings.entryFee).
// The callable seeds squares[]/scores and stamps server-only fields.
function dropUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function buildSquaresPayload(values: Record<string, unknown>): Record<string, unknown> {
  const v = values as Record<string, any>;

  const hp = writePaymentHandles(v.paymentHandles);
  const legacyHandles: Record<string, string> = {};
  (['venmo', 'zelle', 'cashapp', 'paypal'] as const).forEach((k) => {
    const val = hp[k];
    if (val && val !== CLEAR) legacyHandles[k] = val as string;
  });

  return dropUndefined({
    type: 'SQUARES',
    name: v.name,
    costPerSquare: Number(v.costPerSquare ?? 0),
    maxSquaresPerPlayer: Number(v.maxSquaresPerPlayer ?? 0),
    homeTeam: v.homeTeam || undefined,
    awayTeam: v.awayTeam || undefined,
    gameId: v.gameId || undefined,
    numberSets: Number(v.numberSets ?? 1),
    gridSize: v.gridSize || '10x10',
    theme: v.theme || 'default',
    managerName: v.managerName || undefined,
    contactEmail: v.contactEmail || undefined,
    ...legacyHandles,
    paymentHandles: hp.paymentHandles,
    paymentInstructions: v.paymentInstructions || undefined,
    branding: v.branding,
    isPublic: v.isPublic ?? true,
  });
}
