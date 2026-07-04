import { useFormContext } from 'react-hook-form';
import { CheckboxField } from '../fields';

// Final step: a plain-language summary, the free-plan billing note, and the
// Terms gate (_tosAccepted) the shell requires before it enables submit.
export function StepReview(props: { feeField?: string }) {
  const { feeField } = props;
  const { watch } = useFormContext();
  const name = String(watch('name') ?? '');
  const fee = feeField ? Number(watch(feeField) ?? 0) : undefined;

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Review &amp; launch</h3>
      <p className="mb-5 text-sm text-slate-400">One last look before your pool goes live.</p>

      <dl className="mb-5 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/50 text-sm">
        <div className="flex justify-between px-4 py-3">
          <dt className="text-slate-400">Pool name</dt>
          <dd className="font-semibold text-white">{name || '—'}</dd>
        </div>
        {fee !== undefined && (
          <div className="flex justify-between px-4 py-3">
            <dt className="text-slate-400">Entry fee</dt>
            <dd className="font-semibold text-white">{fee > 0 ? `$${fee}` : 'Free'}</dd>
          </div>
        )}
        <div className="flex justify-between px-4 py-3">
          <dt className="text-slate-400">Plan</dt>
          <dd className="font-semibold text-emerald-400">Free — no charge to launch</dd>
        </div>
      </dl>

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        <CheckboxField
          name="_tosAccepted"
          label="I agree to the Terms of Service and confirm entry fees are collected peer-to-peer."
        />
      </div>
    </div>
  );
}
