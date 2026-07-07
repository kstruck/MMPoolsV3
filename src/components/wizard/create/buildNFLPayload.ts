import { writePaymentHandles, CLEAR } from '@shared/paymentHandles';
import type { PoolType } from '@shared/poolTypes';
import { readLaunchFields } from './launchFields';

// Maps validated wizard values to an NFL season-pool payload (Pick'em / Survivor
// / Margin) for dbService.createNFLPool. Settings are passed through per type;
// the callable re-validates and stamps server-only fields. JSON round-trip drops
// undefined for transport.
function dropUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function buildNFLPayload(
  values: Record<string, unknown>,
  poolType: Extract<PoolType, 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN'>,
): Record<string, unknown> {
  const v = values as Record<string, any>;

  const hp = writePaymentHandles(v.paymentHandles);
  const legacyHandles: Record<string, string> = {};
  (['venmo', 'zelle', 'cashapp', 'paypal'] as const).forEach((k) => {
    const val = hp[k];
    if (val && val !== CLEAR) legacyHandles[k] = val as string;
  });

  const isPublic = v.isPublic ?? true;

  return dropUndefined({
    ...readLaunchFields(values),
    type: poolType,
    league: 'NFL',
    name: v.name,
    season: v.season != null && v.season !== '' ? String(v.season) : undefined,
    managerName: v.managerName || undefined,
    contactEmail: v.contactEmail || undefined,
    ...legacyHandles,
    paymentHandles: hp.paymentHandles,
    paymentInstructions: v.paymentInstructions || undefined,
    branding: v.branding,
    isPublic,
    settings: {
      ...(v.settings ?? {}),
      entryFee: Number(v.settings?.entryFee ?? 0),
      isListedPublic: isPublic,
      paymentInstructions: v.paymentInstructions || undefined,
      payouts: v.settings?.payouts,
    },
  });
}
