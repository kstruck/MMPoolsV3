// Once-scored rejection for the two survivor parity settings
// (PLAN-SURVIVOR-PARITY-SCORING decision 4).
//
// WHY A SERVER GATE AND NOT UI GATING. `computeSurvivorWeekUpdate` recomputes
// past weeks with the pool's CURRENT settings, so flipping `tieCountsAs` after a
// tied week rewrites history on the next rescore, and changing `maxTeamUses`
// adds or removes auto-survive exemptions the same way. The callable stays
// reachable regardless of what the UI offers, and a super-admin bypasses the UI
// entirely — so the refusal has to live where the write happens.
//
// Pure, so every refusal is unit-testable rather than inferred from a
// transaction. The caller evaluates it INSIDE the transaction that writes, with
// the pool and the entries read in that same transaction.

import {
  countTeamUses,
  effectiveMaxTeamUses,
  effectiveTieCountsAs,
  UNLIMITED_TEAM_USES,
} from '../shared/survivorReuse';
import { legacyPublishedWeeks } from './publishedWeeks';

/** The two fields this gate protects, as they appear in a dotted patch. */
export const SURVIVOR_PARITY_SETTINGS_KEYS = ['tieCountsAs', 'maxTeamUses'] as const;

export function touchesSurvivorParitySettings(patch: Record<string, unknown>): boolean {
  return SURVIVOR_PARITY_SETTINGS_KEYS.some((k) => `settings.${k}` in patch);
}

/**
 * Has this pool published any scored week?
 *
 * A **true** marker in `publishedWeeks`, or any legacy scoring evidence
 * (`scoredWeeks` true markers and the `scoredThroughWeek` high-water mark, both
 * folded in by `legacyPublishedWeeks`).
 *
 * `false` markers mean UNSCORED and must not trip the gate — the marker maps
 * genuinely hold them. And `scoredWeeks` is withheld on provisional passes
 * (`nflPools.ts`), which is why `publishedWeeks` is read too rather than
 * treating `scoredWeeks` as the whole story: the provisional window is exactly
 * when members have seen a result that no `scoredWeeks` marker records yet.
 *
 * Lifecycle status is deliberately NOT a proxy: a pool can hold scored survivor
 * outcomes while still lifecycle-open, and the editability matrix permits
 * settings edits in that phase.
 */
export function poolHasScoredWeek(pool: Record<string, unknown> | undefined): boolean {
  const published = pool?.publishedWeeks as Record<string, unknown> | undefined;
  if (published && typeof published === 'object' && Object.values(published).some((v) => v === true)) {
    return true;
  }
  return legacyPublishedWeeks(pool).length > 0;
}

/**
 * Does judging this patch require reading the pool's entries?
 *
 * Only the reduction invariant looks at them, and only when `maxTeamUses` is
 * actually moving DOWN to a positive limit. The manager UI submits a complete
 * settings object on every save, so without this check every ordinary survivor
 * settings save would read every entry in the pool inside a transaction — for a
 * large pool, hundreds of reads to confirm nothing changed.
 *
 * Call it with the pool read inside the transaction, before reading entries;
 * Firestore allows sequential reads, it forbids a read after a write.
 */
export function parityEditNeedsEntries(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): boolean {
  if (pool?.type !== 'NFL_SURVIVOR') return false;
  if (!('settings.maxTeamUses' in patch)) return false;
  // A scored pool is refused on the value change alone — no entries needed.
  if (poolHasScoredWeek(pool)) return false;
  const incoming = effectiveMaxTeamUses({ maxTeamUses: patch['settings.maxTeamUses'] });
  const current = effectiveMaxTeamUses((pool?.settings ?? {}) as Record<string, unknown>);
  if (incoming === current || incoming === UNLIMITED_TEAM_USES) return false;
  // Unlimited -> any positive limit is always a reduction; otherwise compare.
  return current === UNLIMITED_TEAM_USES || incoming < current;
}

export type SurvivorParityRefusal =
  | { code: 'SETTINGS_LOCKED_AFTER_SCORING'; field: string; message: string }
  | { code: 'TEAM_USE_LIMIT_TOO_LOW'; field: string; message: string };

/**
 * May this settings patch change either parity field right now?
 *
 * Returns the refusal, or null to allow.
 *
 * Two rules, and both are narrower than they look on purpose:
 *
 *  1. **Present-only, and by EFFECTIVE value.** A field is judged only when the
 *     patch actually carries it — the manager UI sends a complete settings
 *     object, but `flattenSettingsPatch` applies present keys only, so a partial
 *     `{maxStrikes: 2}` save on a scored pool must not be refused over a field
 *     it never mentioned. And the comparison is `current ?? default` vs
 *     `incoming ?? default`, so a scored legacy pool saving the UI's defaults is
 *     not refused over `undefined -> 'LOSS'`.
 *  2. **Reduction invariant.** Lowering `maxTeamUses` to a positive limit is
 *     refused while any entry already exceeds it (unlimited or 2 down to 1 after
 *     somebody picked KC twice). Nothing later would catch those entries — no
 *     write touches them — so they would sit permanently over a limit the pool
 *     claims to enforce. Increases are always fine, and so is a move to
 *     unlimited.
 */
export function survivorParitySettingsRefusal(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
  entries: ReadonlyArray<{ picks?: Record<string | number, unknown> } | undefined>,
): SurvivorParityRefusal | null {
  if (pool?.type !== 'NFL_SURVIVOR') return null;

  const settings = (pool?.settings ?? {}) as Record<string, unknown>;
  const scored = poolHasScoredWeek(pool);

  if ('settings.tieCountsAs' in patch) {
    const incoming = effectiveTieCountsAs({ tieCountsAs: patch['settings.tieCountsAs'] });
    if (incoming !== effectiveTieCountsAs(settings) && scored) {
      return {
        code: 'SETTINGS_LOCKED_AFTER_SCORING',
        field: 'tieCountsAs',
        message:
          'SETTINGS_LOCKED_AFTER_SCORING: this pool has already published a scored week, so the tie rule can no longer be changed — it would rewrite that week on the next rescore.',
      };
    }
  }

  if ('settings.maxTeamUses' in patch) {
    const incoming = effectiveMaxTeamUses({ maxTeamUses: patch['settings.maxTeamUses'] });
    const current = effectiveMaxTeamUses(settings);
    if (incoming !== current) {
      if (scored) {
        return {
          code: 'SETTINGS_LOCKED_AFTER_SCORING',
          field: 'maxTeamUses',
          message:
            'SETTINGS_LOCKED_AFTER_SCORING: this pool has already published a scored week, so the team-use limit can no longer be changed — it would move auto-survive exemptions on the next rescore.',
        };
      }
      if (incoming !== UNLIMITED_TEAM_USES) {
        const worst = entries.reduce((max, entry) => {
          const counts = Object.values(countTeamUses(entry?.picks));
          return counts.length === 0 ? max : Math.max(max, ...counts);
        }, 0);
        if (worst > incoming) {
          return {
            code: 'TEAM_USE_LIMIT_TOO_LOW',
            field: 'maxTeamUses',
            message:
              `TEAM_USE_LIMIT_TOO_LOW: a member has already picked the same team ${worst} times, so the limit cannot be lowered to ${incoming}. Raise it, or set 0 for unlimited.`,
          };
        }
      }
    }
  }

  return null;
}
