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

function hybridSplitFrom(settings: Record<string, unknown> | undefined): { weeklyPerEntry: number; seasonPerEntry: number } | undefined {
  if (settings?.payoutMode !== 'HYBRID') return undefined;
  const raw = settings?.hybridSplit as { weeklyPerEntry?: unknown; seasonPerEntry?: unknown } | undefined;
  if (!raw) return undefined;
  // BOTH untouched (NaN from valueAsNumber on empty inputs) = nothing declared.
  // Manufacturing {0,0} here made a zero-fee HYBRID pool impossible to create:
  // the declared split tripped HYBRID_SPLIT_NEEDS_FEE where an absent one is
  // explicitly valid. One touched field still declares — half an answer should
  // be refused loudly, not silently dropped. (codex r3 on the split PR.)
  const w = Number(raw.weeklyPerEntry);
  const se = Number(raw.seasonPerEntry);
  if (!Number.isFinite(w) && !Number.isFinite(se)) return undefined;
  const num = (x: number) => (Number.isFinite(x) ? x : 0);
  return { weeklyPerEntry: num(w), seasonPerEntry: num(se) };
}

// Not clamped: an out-of-range value must be REFUSED by the schema (with its
// message on the field), not silently reinterpreted — same rule as maxTeamUses.
function maxEntriesFrom(v: Record<string, any>): number {
  if (!v.multiEntry) return 1;
  const n = Number(v.settings?.maxEntriesPerUser);
  return Number.isFinite(n) ? n : 1;
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
    // 1=preseason, 2=regular, 3=postseason; select fields deliver strings.
    seasonType: v.seasonType ? Number(v.seasonType) : undefined,
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
      // The hybrid split survives ONLY on a HYBRID pool. react-hook-form keeps
      // unmounted field values (shouldUnregister defaults false), so a manager
      // who tried HYBRID, typed a split, then settled on SEASON would submit a
      // stray split the create schema rightly refuses — on a screen where the
      // fields are no longer visible. And `valueAsNumber` reads an untouched
      // input as NaN; normalizing to 0 here lets the schema's mismatch message
      // (the useful one) fire instead of a bare "expected number, got nan".
      hybridSplit: hybridSplitFrom(v.settings),
      // PLAN-MULTI-ENTRY D8. Toggle off ⇒ 1 regardless of what was typed (the
      // field is unmounted but react-hook-form keeps its value); toggle on with
      // an untouched field (NaN) ⇒ 1 too, so the schema's 1..CAP check is the
      // only refusal a commissioner can hit, and it says why.
      maxEntriesPerUser: maxEntriesFrom(v),
    },
  });
}
