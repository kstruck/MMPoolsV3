// `settings.confidenceMode` may not change once anybody has submitted
// (PLAN-CONFIDENCE-PER-GAME-LOCK T10, codex r1 #8).
//
// Flipping it changes SCORING — a correct pick is worth its weight when on and
// one point when off (`scorePickemEntry`) — and, from that plan on, which lock
// rule the pool plays. The weekly tiebreaker already has exactly the right gate
// (`weeklyTiebreakerGate.ts`: refused once anybody has submitted, judged inside
// the write transaction so a first submission cannot land behind the check).
// This is that gate for one more field, and it deliberately shares the
// tiebreaker's `poolHasSubmission` so "has anybody submitted" has one meaning.
//
// The manager UI sends a COMPLETE settings object on every save, so the key is
// in every patch; only a CHANGED value is judged.
import { poolHasScoredWeek } from './survivorSettingsGate';
import { poolHasSubmission } from './weeklyTiebreakerGate';

export const CONFIDENCE_MODE_SETTING_KEY = 'settings.confidenceMode';

export function touchesConfidenceModeSetting(patch: Record<string, unknown>): boolean {
  return CONFIDENCE_MODE_SETTING_KEY in patch;
}

function changesConfidenceMode(pool: Record<string, unknown> | undefined, patch: Record<string, unknown>): boolean {
  const incoming = patch[CONFIDENCE_MODE_SETTING_KEY] === true;
  const current = ((pool?.settings ?? {}) as { confidenceMode?: unknown }).confidenceMode === true;
  return incoming !== current;
}

/** Does judging this patch need the entries read (only when the value moves)? */
export function confidenceModeEditNeedsEntries(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): boolean {
  if (pool?.type !== 'NFL_PICKEM') return false;
  if (!touchesConfidenceModeSetting(patch)) return false;
  if (!changesConfidenceMode(pool, patch)) return false;
  return !poolHasScoredWeek(pool);
}

export type ConfidenceModeRefusal = {
  code: 'CONFIDENCE_MODE_LOCKED_AFTER_SUBMISSIONS' | 'SETTINGS_LOCKED_AFTER_SCORING';
  field: 'confidenceMode';
  message: string;
};

export function confidenceModeRefusal(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
  entries: ReadonlyArray<{ picks?: Record<string, unknown>; weeklyTiebreakers?: Record<string, unknown> } | undefined>,
): ConfidenceModeRefusal | null {
  if (pool?.type !== 'NFL_PICKEM') return null;
  if (!touchesConfidenceModeSetting(patch)) return null;
  if (!changesConfidenceMode(pool, patch)) return null;

  if (poolHasScoredWeek(pool)) {
    return {
      code: 'SETTINGS_LOCKED_AFTER_SCORING',
      field: 'confidenceMode',
      message:
        'SETTINGS_LOCKED_AFTER_SCORING: this pool has already published a scored week, so confidence mode can no longer be changed — it would rewrite what that week reported.',
    };
  }
  if (poolHasSubmission(entries)) {
    return {
      code: 'CONFIDENCE_MODE_LOCKED_AFTER_SUBMISSIONS',
      field: 'confidenceMode',
      message:
        'CONFIDENCE_MODE_LOCKED_AFTER_SUBMISSIONS: members have already submitted picks in this pool, so confidence mode can no longer be changed — their sheets were made under the other rule.',
    };
  }
  return null;
}
