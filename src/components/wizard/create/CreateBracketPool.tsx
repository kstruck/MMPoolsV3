import { useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import type { User } from '../../../types';
import { functions } from '../../../firebase';
import { bracketCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, LaunchStep } from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { NumberField, SelectField, CheckboxField } from '../fields';
import type { WizardStepDef } from '../types';
import { prefillFromUser } from './profilePrefill';
import { buildBracketPayload } from './buildBracketPayload';

// Creates the bracket DRAFT and RESOLVES the new poolId (no navigation) so the
// LaunchStep can then run checkout/redeem on it. createBracketPool returns
// { poolId } in result.data.
async function createBracketPool(values: Record<string, unknown>): Promise<string> {
  const call = httpsCallable(functions, 'createBracketPool');
  const result = await call(buildBracketPayload(values));
  const poolId = (result.data as { poolId?: string })?.poolId;
  if (!poolId) throw new Error('Pool creation did not return an id.');
  return poolId;
}

// Bracket create makes a DRAFT; the commissioner publishes it (slug + password)
// afterward via the existing publish flow — out of this create wizard.
function StepBracketDetails() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Tournament</h3>
      <p className="mb-5 text-sm text-slate-400">Which bracket and how it scores.</p>
      <NumberField name="seasonYear" label="Season year" min={2000} placeholder="2026" />
      <div className="grid grid-cols-2 gap-x-4">
        <SelectField name="gender" label="Bracket" options={[
          { value: 'mens', label: "Men's" },
          { value: 'womens', label: "Women's" },
        ]} />
        <SelectField name="tournamentType" label="Tournament" options={[
          { value: 'ncaa', label: 'NCAA' },
          { value: 'bigeast', label: 'Big East' },
          { value: 'big12', label: 'Big 12' },
        ]} />
      </div>
      <SelectField name="settings.scoringSystem" label="Scoring system" options={[
        { value: 'CLASSIC', label: 'Classic' },
        { value: 'UPSET', label: 'Upset bonus' },
        { value: 'CUSTOM', label: 'Custom' },
      ]} />
      <CheckboxField name="settings.tieBreakers.closestAbsolute" label="Tiebreaker: closest to final score (absolute)" />
      <CheckboxField name="settings.tieBreakers.closestUnder" label="Tiebreaker: closest without going over" />
    </div>
  );
}

const defaultValues: Record<string, unknown> = {
  type: 'BRACKET',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  seasonYear: 2026, gender: 'mens', tournamentType: 'ncaa',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  // Launch inputs (LaunchStep): estimate + premium add-ons drive the server's
  // free-vs-trial decision and the quote. All add-ons default off.
  estimatedPlayers: 0,
  addons: { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false },
  settings: {
    entryFee: 0,
    scoringSystem: 'CLASSIC',
    tieBreakers: { closestAbsolute: true, closestUnder: false },
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
  _tosAccepted: false,
};

export function CreateBracketPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
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
    { id: 'tournament', title: 'Tournament', fields: ['seasonYear'], Component: StepBracketDetails },
    { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
    { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
    { id: 'branding', title: 'Branding', Component: StepBranding },
    {
      id: 'launch', title: 'Launch', ownsSubmit: true,
      Component: () => (
        <LaunchStep
          uid={user.id}
          user={user}
          poolType="BRACKET"
          feeField="settings.entryFee"
          createPool={createBracketPool}
          onCreated={onComplete}
        />
      ),
    },
  ], [user, onComplete]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create a Bracket pool</h1>
      </div>
      <WizardShell
        poolType="BRACKET"
        steps={steps}
        schema={bracketCreateInputSchema}
        defaultValues={seededDefaults}
        userId={user.id}
        submitLabel="Create draft"
        onSubmit={async (values) => {
          // Fallback only — the LaunchStep owns the create → launch state machine
          // and the shell hides its footer submit on that step, so this is not
          // reached in the create flow. Kept functional for contract safety.
          onComplete(await createBracketPool(values));
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
