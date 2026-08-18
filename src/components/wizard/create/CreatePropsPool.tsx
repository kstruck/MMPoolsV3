import { useMemo } from 'react';
import { useFieldArray, useFormContext, Controller } from 'react-hook-form';
import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { propsCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, LaunchStep } from '../index';
import { TextField, NumberField, Field } from '../fields';
import type { WizardStepDef } from '../types';
import { prefillFromUser } from './profilePrefill';
import { buildPropsPayload } from './buildPropsPayload';

// Creates the PROPS pool and RESOLVES its poolId (no navigation) for LaunchStep.
async function createPropsPool(values: Record<string, unknown>): Promise<string> {
  return dbService.createPool(buildPropsPayload(values));
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500';

// Props questions builder. Each question keeps its options as a real string[]
// (edited via a comma-separated input through Controller) so the zod resolver
// validates the array shape (2–4 options).
function StepPropsSetup() {
  const { register, control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'props.questions' });

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Props setup</h3>
      <p className="mb-5 text-sm text-slate-400">The matchup and the questions players answer.</p>

      <div className="grid grid-cols-2 gap-x-4">
        <TextField name="homeTeam" label="Home team" placeholder="Optional" />
        <TextField name="awayTeam" label="Away team" placeholder="Optional" />
      </div>
      <NumberField name="props.maxCards" label="Max cards per player" min={1} />

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Questions</p>
      <div className="space-y-4">
        {fields.map((f, i) => (
          <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Question {i + 1}</span>
              <button type="button" onClick={() => remove(i)} className="text-xs font-semibold text-rose-400 hover:text-rose-300">Remove</button>
            </div>
            <Field label="Prompt" htmlFor={`q-${i}-text`} helpId="props.questions.*.text">
              <input id={`q-${i}-text`} className={inputCls} placeholder="Who wins the coin toss?" {...register(`props.questions.${i}.text`)} />
            </Field>
            <Controller
              control={control}
              name={`props.questions.${i}.options`}
              render={({ field }) => (
                <Field label="Options (comma-separated, 2–4)" htmlFor={`q-${i}-opts`} helpId="props.questions.*.options">
                  <input
                    id={`q-${i}-opts`}
                    className={inputCls}
                    value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                    onChange={(e) => field.onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                    placeholder="Heads, Tails"
                  />
                </Field>
              )}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => append({ text: '', options: ['', ''] })}
        className="mt-2 rounded-md border border-slate-700 px-4 py-1.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
      >
        + Add question
      </button>
    </div>
  );
}

const defaultValues: Record<string, unknown> = {
  type: 'PROPS',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  homeTeam: '', awayTeam: '', theme: 'default',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  // Empty array, not a pre-seeded blank question: a blank question fails the
  // schema's min(1)-text/min(2)-options validation, which would silently
  // block "Next" on the setup step before the commissioner touches anything.
  props: { cost: 0, maxCards: 1, questions: [] },
  // Launch inputs (LaunchStep): player estimate + add-ons drive free vs trial.
  estimatedPlayers: 0,
  addons: { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false },
  _tosAccepted: false,
};

export function CreatePropsPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
  const { user, onComplete, onCancel } = props;
  // Start from the commissioner's own profile: they are already a signed-in
  // member, so their name, contact email and payout handles are known.
  //
  // Read ONCE, at mount. `useForm({ defaultValues })` in WizardShell does not
  // re-initialise when this object changes, and that is fine here rather than a
  // latent bug: App.tsx gates this whole route on `user &&`, so the wizard never
  // mounts with a null user and there is no late-arriving profile to wait for.
  // It is also the safe direction — the post-create write-back updates the user
  // doc, and a shell that DID re-initialise would wipe a half-filled form the
  // moment that landed. The useMemo is for referential stability, nothing more.
  const seededDefaults = useMemo(() => ({ ...defaultValues, ...prefillFromUser(user) }), [user]);
  const steps: WizardStepDef[] = useMemo(() => [
    { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
    { id: 'setup', title: 'Props setup', fields: ['props.questions'], Component: StepPropsSetup },
    { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="props.cost" feeLabel="Cost per card ($)" /> },
    { id: 'branding', title: 'Branding', Component: StepBranding },
    {
      id: 'launch', title: 'Launch', ownsSubmit: true,
      Component: () => (
        <LaunchStep
          uid={user.id}
          user={user}
          poolType="PROPS"
          feeField="props.cost"
          createPool={createPropsPool}
          onCreated={onComplete}
        />
      ),
    },
  ], [user, onComplete]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create a Props pool</h1>
      </div>
      <WizardShell
        poolType="PROPS"
        steps={steps}
        schema={propsCreateInputSchema}
        defaultValues={seededDefaults}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          // Fallback only — LaunchStep owns the create → launch flow (see Bracket).
          onComplete(await createPropsPool(values));
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
