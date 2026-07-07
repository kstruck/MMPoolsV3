import { writePaymentHandles, CLEAR } from '@shared/paymentHandles';
import { PLAYOFF_PLACEHOLDER_TEAMS } from './playoffTeams';
import { readLaunchFields } from './launchFields';

// Maps validated wizard form values to the NFL_PLAYOFFS pool payload for
// dbService.createPool (which routes to the createPool callable). The callable
// re-validates and stamps server-only fields (billing/status/ownerId/id), so we
// never send those. JSON round-trip drops undefined for Firestore/transport.
function dropUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function buildPlayoffPayload(values: Record<string, unknown>): Record<string, unknown> {
  const v = values as Record<string, any>;

  // Nested handles are canonical; dual-write the legacy top-level fields the
  // playoff pool doc + dashboards read.
  const hp = writePaymentHandles(v.paymentHandles);
  const legacyHandles: Record<string, string> = {};
  (['venmo', 'zelle', 'cashapp', 'paypal'] as const).forEach((k) => {
    const val = hp[k];
    if (val && val !== CLEAR) legacyHandles[k] = val as string;
  });

  return dropUndefined({
    ...readLaunchFields(values),
    type: 'NFL_PLAYOFFS',
    league: 'NFL',
    name: v.name,
    season: v.season != null && v.season !== '' ? String(v.season) : undefined,
    urlSlug: v.slug || undefined,
    managerName: v.managerName || undefined,
    contactEmail: v.contactEmail || undefined,
    ...legacyHandles,
    paymentHandles: hp.paymentHandles,
    paymentInstructions: v.paymentInstructions || undefined,
    branding: v.branding,
    reminders: v.reminders,
    isPublic: v.isPublic ?? true,
    settings: {
      entryFee: Number(v.settings?.entryFee ?? 0),
      maxEntriesTotal: v.settings?.maxEntriesTotal,
      maxEntriesPerUser: v.settings?.maxEntriesPerUser,
      paymentInstructions: v.paymentInstructions || undefined,
      isListedPublic: v.isPublic ?? true,
      payouts: v.settings?.payouts,
      scoring: v.settings?.scoring,
    },
    teams: PLAYOFF_PLACEHOLDER_TEAMS,
    results: {},
    // lockDate may arrive as a datetime-local string or a millis number.
    lockDate: toMillis(v.lockDate),
  });
}

function toMillis(input: unknown): number | undefined {
  if (input == null || input === '') return undefined;
  if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
  const ms = new Date(input as string).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}
