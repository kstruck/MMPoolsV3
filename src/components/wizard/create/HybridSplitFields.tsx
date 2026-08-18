import { useFormContext } from 'react-hook-form';
import { NumberField } from '../fields';
import { hybridSplitProblem } from '@shared/hybridSplit';

/**
 * The HYBRID entry-fee split (PLAN-HYBRID-SPLIT, Kevin 2026-08-13).
 *
 * Rendered only while `settings.payoutMode === 'HYBRID'` — same conditional
 * pattern as AtsWarning, shown at the point of choice. The live check line
 * runs the SAME `hybridSplitProblem` the create schema and the update callable
 * enforce, so what this preview approves is exactly what the server accepts —
 * a second, friendlier phrasing here would eventually disagree with the
 * refusal message, and money copy that disagrees with money enforcement is
 * how commissioners stop trusting either.
 *
 * Rendered under the entry-fee field on `StepFeeAndPayment` (PLAN-PAYMENT-LEDGER
 * T0 / D0 — it used to sit on the rules step, one step BEFORE the fee it must
 * sum to). The check line still has three states: fee not set yet (explain,
 * don't scold), mismatch (the server's own words), and balanced (the sum,
 * affirmed). Field names, `hybridSplitProblem`, and every validation line are
 * unchanged — the move is display only.
 */
export function HybridSplitFields() {
  const { watch } = useFormContext();
  if (watch('settings.payoutMode') !== 'HYBRID') return null;

  const weekly = Number(watch('settings.hybridSplit.weeklyPerEntry') ?? 0);
  const season = Number(watch('settings.hybridSplit.seasonPerEntry') ?? 0);
  const entryFee = Number(watch('settings.entryFee') ?? 0);

  const problem = hybridSplitProblem({
    payoutMode: 'HYBRID',
    entryFee,
    hybridSplit: { weeklyPerEntry: weekly, seasonPerEntry: season },
  });

  return (
    <div className="mb-4 rounded-lg border border-line bg-page p-3">
      <p className="text-sm font-semibold mb-1">Hybrid entry-fee split</p>
      <p className="text-xs text-muted mb-3">
        How each entry fee divides between the weekly prize pots and the season pot.
        Whole dollars, and the two must add up to the entry fee exactly. Each pot
        gets its own prize places on the Payouts step.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField name="settings.hybridSplit.weeklyPerEntry" label="Weekly pots ($ per entry)" min={0} />
        <NumberField name="settings.hybridSplit.seasonPerEntry" label="Season pot ($ per entry)" min={0} />
      </div>
      {entryFee <= 0 ? (
        <p role="status" className="mt-2 text-xs text-muted">
          Set the entry fee above — the split must add up to it, and it is not set yet.
        </p>
      ) : problem ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-brandred-600">
          ✗ {problem.split(': ').slice(1).join(': ')}
        </p>
      ) : (
        <p role="status" className="mt-2 text-xs font-semibold text-[#0F7B4A]">
          ✓ ${weekly} weekly + ${season} season = ${entryFee} entry fee
        </p>
      )}
    </div>
  );
}
