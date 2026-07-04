import { useFieldArray, useFormContext } from 'react-hook-form';
import { Field } from '../fields';

// Shared payouts editor for the places/bonuses shape (Bracket/Playoff/NFL). The
// payouts object path is a prop (e.g. "settings.payouts"). Live total warns when
// the split exceeds 100% — the schema rejects it server-side too.
export function StepPayouts(props: { payoutsField?: string }) {
  const { payoutsField = 'settings.payouts' } = props;
  const { control, register, watch } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: `${payoutsField}.places` });

  const places = (watch(`${payoutsField}.places`) as Array<{ percentage?: number }> | undefined) ?? [];
  const total = places.reduce((sum, p) => sum + (Number(p?.percentage) || 0), 0);
  const over = total > 100;

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Payouts</h3>
      <p className="mb-5 text-sm text-slate-400">How the pot is split. Percentages must total 100% or less.</p>

      <div className="space-y-3">
        {fields.map((f, i) => (
          <div key={f.id} className="flex items-end gap-3">
            <Field label={`Place #${i + 1} rank`}>
              <input type="number" min={1} className={inputCls} {...register(`${payoutsField}.places.${i}.rank`, { valueAsNumber: true })} />
            </Field>
            <Field label="Percentage">
              <input type="number" min={0} max={100} className={inputCls} {...register(`${payoutsField}.places.${i}.percentage`, { valueAsNumber: true })} />
            </Field>
            <button type="button" onClick={() => remove(i)} className="mb-4 rounded-md px-3 py-2 text-sm font-semibold text-rose-400 hover:text-rose-300">
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => append({ rank: fields.length + 1, percentage: 0 })}
        className="mt-2 rounded-md border border-slate-700 px-4 py-1.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
      >
        + Add place
      </button>

      <p className={`mt-4 text-sm font-semibold ${over ? 'text-rose-400' : 'text-slate-300'}`}>
        Total: {total}% {over && '— exceeds 100%'}
      </p>
    </div>
  );
}
