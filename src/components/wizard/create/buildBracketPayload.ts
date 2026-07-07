import { readPaymentHandles } from '@shared/paymentHandles';
import { readLaunchFields } from './launchFields';

// Maps validated wizard values to the createBracketPool callable payload
// ({ name, seasonYear, gender, tournamentType, settings }). Bracket stores
// handles nested under settings.paymentHandles. JSON round-trip drops undefined.
function dropUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function buildBracketPayload(values: Record<string, unknown>): Record<string, unknown> {
  const v = values as Record<string, any>;
  const handles = readPaymentHandles({ paymentHandles: v.paymentHandles });

  return dropUndefined({
    ...readLaunchFields(values),
    name: v.name,
    seasonYear: Number(v.seasonYear),
    gender: v.gender || 'mens',
    tournamentType: v.tournamentType || 'ncaa',
    settings: {
      maxEntriesTotal: Number.isFinite(v.settings?.maxEntriesTotal) ? v.settings.maxEntriesTotal : undefined,
      maxEntriesPerUser: Number.isFinite(v.settings?.maxEntriesPerUser) ? v.settings.maxEntriesPerUser : undefined,
      entryFee: Number(v.settings?.entryFee ?? 0),
      paymentInstructions: v.paymentInstructions || undefined,
      paymentHandles: Object.keys(handles).length > 0 ? handles : undefined,
      scoringSystem: v.settings?.scoringSystem || 'CLASSIC',
      tieBreakers: v.settings?.tieBreakers,
      payouts: v.settings?.payouts,
    },
  });
}
