import { useFormContext } from 'react-hook-form';
import { NumberField, TextField, TextAreaField } from '../fields';

// Shared entry-fee + payment-handle step. The fee lives at a type-specific path
// (settings.entryFee, costPerSquare, props.cost), so each wizard passes it in.
// Handles are always the canonical nested paymentHandles.* and only appear once
// a fee is set — reinforcing that money moves peer-to-peer, never through the app.
export function StepFeeAndPayment(props: { feeField: string; feeLabel?: string }) {
  const { feeField, feeLabel = 'Entry fee per player ($)' } = props;
  const { watch } = useFormContext();
  const fee = Number(watch(feeField) ?? 0);

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Entry fee &amp; payment</h3>
      <p className="mb-5 text-sm text-slate-400">Set the buy-in. Players pay you directly — the app never touches this money.</p>

      <NumberField name={feeField} label={feeLabel} min={0} placeholder="0" hint="Leave at 0 for a free pool." />

      {fee > 0 && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            How players pay you
          </p>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <TextField name="paymentHandles.venmo" label="Venmo" placeholder="@handle" />
            <TextField name="paymentHandles.zelle" label="Zelle" placeholder="email / phone" />
            <TextField name="paymentHandles.cashapp" label="Cash App" placeholder="$cashtag" />
            <TextField name="paymentHandles.paypal" label="PayPal" placeholder="paypal.me/…" />
            <TextField name="paymentHandles.googlePay" label="Google Pay" placeholder="email / phone" />
          </div>
          <TextAreaField
            name="paymentInstructions"
            label="Payment instructions"
            placeholder="e.g. Venmo me before the first game and add your name in the note."
          />
        </div>
      )}
    </div>
  );
}
