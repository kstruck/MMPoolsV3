import { useFieldArray, useFormContext } from 'react-hook-form';
import { DUPLICATE_RANK_MESSAGE, uniqueRanks } from '@shared/schemas/common';
import { Field } from '../fields';

// Shared payouts editor for the places/bonuses shape (Bracket/Playoff/NFL). The
// payouts object path is a prop (e.g. "settings.payouts"). Live total warns when
// the split exceeds 100% — the schema rejects it server-side too.
//
// PLAN-PAYMENT-LEDGER T2 / D2: on HYBRID the step renders the editor TWICE —
// "Weekly prizes" bound to `settings.weeklyPayouts`, "Season prizes" bound to
// `settings.payouts` — because a HYBRID pool has two pots and the D1 matrix
// gives each its own place list. WEEKLY and SEASON render ONE editor bound to
// `settings.payouts`, exactly as before: `weeklyPayouts` is HYBRID-only and the
// create schema refuses it on any other mode.
function PlacesEditor(props: { payoutsField: string; title?: string; blurb?: string }) {
  const { payoutsField, title, blurb } = props;
  const { control, register, watch } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: `${payoutsField}.places` });

  const places = (watch(`${payoutsField}.places`) as Array<{ rank?: number; percentage?: number }> | undefined) ?? [];
  const total = places.reduce((sum, p) => sum + (Number(p?.percentage) || 0), 0);
  const over = total > 100;
  // The SAME predicate the create schema and the update callable enforce — a
  // second local phrasing of "ranks must be unique" would eventually disagree
  // with the refusal. Blank rank inputs (NaN) are skipped: two untouched rows
  // are incomplete, not duplicates, and the schema says so in its own words.
  const ranked = places
    .filter((p) => Number.isFinite(Number(p?.rank)))
    .map((p) => ({ rank: Number(p?.rank) }));
  const duplicateRank = !uniqueRanks(ranked);
  // One past the highest rank present, NOT `fields.length + 1`: remove rank 1
  // from [1, 2] and `length + 1` hands out a second rank 2, so the editor's own
  // controls build a list the create schema refuses (codex r3 on T2).
  const nextRank = ranked.reduce((max, p) => Math.max(max, p.rank), 0) + 1;

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div>
      {title && <p className="mb-1 text-sm font-bold text-white">{title}</p>}
      {blurb && <p className="mb-4 text-xs text-slate-400">{blurb}</p>}

      <div className="space-y-3">
        {fields.map((f, i) => (
          <div key={f.id} className="flex items-end gap-3">
            <Field label={`Place #${i + 1} rank`}>
              <input type="number" min={1} className={inputCls} {...register(`${payoutsField}.places.${i}.rank`, { valueAsNumber: true })} />
            </Field>
            <Field label="Percentage">
              {/* `step="any"`: percentages are `z.number().min(0).max(100)`, not
                  integers, and a bare number input defaults to step=1 and marks
                  a 33.3 invalid. Same as the manager editor (qodo #2). */}
              <input type="number" min={0} max={100} step="any" className={inputCls} {...register(`${payoutsField}.places.${i}.percentage`, { valueAsNumber: true })} />
            </Field>
            <button type="button" onClick={() => remove(i)} className="mb-4 rounded-md px-3 py-2 text-sm font-semibold text-rose-400 hover:text-rose-300">
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => append({ rank: nextRank, percentage: 0 })}
        className="mt-2 rounded-md border border-slate-700 px-4 py-1.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
      >
        + Add place
      </button>

      <p className={`mt-4 text-sm font-semibold ${over ? 'text-rose-400' : 'text-slate-300'}`}>
        Total: {total}% {over && '— exceeds 100%'}
      </p>
      {duplicateRank && (
        <p role="alert" className="mt-1 text-sm font-semibold text-rose-400">
          {DUPLICATE_RANK_MESSAGE.split(': ').slice(1).join(': ')}
        </p>
      )}
    </div>
  );
}

export function StepPayouts(props: { payoutsField?: string }) {
  const { payoutsField = 'settings.payouts' } = props;
  const { watch } = useFormContext();
  // Self-gating on the same field HybridSplitFields watches, so every wizard
  // that has no payout mode (Bracket, Playoff, Survivor) renders one editor.
  const hybrid = watch('settings.payoutMode') === 'HYBRID';

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Payouts</h3>
      <p className="mb-5 text-sm text-slate-400">
        {hybrid
          ? 'This pool pays weekly AND on the final season standings, so each pot gets its own places. Percentages must total 100% or less within each list.'
          : 'How the pot is split. Percentages must total 100% or less.'}
      </p>

      {hybrid ? (
        <div className="space-y-8">
          {/* `settings.weeklyPayouts` is literal: the HYBRID branch only ever runs
              under `settings.payoutMode`, so both lists live under `settings`. */}
          <PlacesEditor
            payoutsField="settings.weeklyPayouts"
            title="Weekly prizes — % of the weekly pot"
            blurb="Applied to EACH week's pot. Leave this empty to use the season places for both pots (what a hybrid pool does today)."
          />
          <PlacesEditor
            payoutsField={payoutsField}
            title="Season prizes — % of the season pot"
            blurb="Applied once, to the final season standings."
          />
        </div>
      ) : (
        <PlacesEditor payoutsField={payoutsField} />
      )}
    </div>
  );
}
