import { useMemo } from 'react';
import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { squaresCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, LaunchStep } from '../index';
import { TextField, NumberField, SelectField } from '../fields';
import type { WizardStepDef } from '../types';
import { prefillFromUser } from './profilePrefill';
import { buildSquaresPayload } from './buildSquaresPayload';

// Creates the SQUARES pool and RESOLVES its poolId (no navigation) for LaunchStep.
async function createSquaresPool(values: Record<string, unknown>): Promise<string> {
  return dbService.createPool(buildSquaresPayload(values));
}

// Squares-specific slot: the matchup + grid rules.
function StepSquaresDetails() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">The matchup &amp; grid</h3>
      <p className="mb-5 text-sm text-slate-400">Which teams, and how the grid works.</p>
      <div className="grid grid-cols-2 gap-x-4">
        {/* One explanation, two fields (voice rule 10) — both point at the
            shared `matchup.teams` topic rather than repeating it. */}
        <TextField name="homeTeam" label="Home team (rows)" placeholder="Chiefs" helpId="matchup.teams" />
        <TextField name="awayTeam" label="Away team (columns)" placeholder="Eagles" helpId="matchup.teams" />
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <NumberField name="maxSquaresPerPlayer" label="Max squares per player (0 = no limit)" min={0} />
        <SelectField name="numberSets" label="Number sets" options={[
          { value: '1', label: 'One set of numbers' },
          { value: '4', label: 'New numbers each quarter' },
        ]} />
      </div>
    </div>
  );
}

const defaultValues: Record<string, unknown> = {
  type: 'SQUARES',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  homeTeam: '', awayTeam: '',
  costPerSquare: 0, maxSquaresPerPlayer: 0, numberSets: '1', gridSize: '10x10', theme: 'default',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  // Launch inputs (LaunchStep). A 10x10 grid is 100 squares, but "players" is a
  // separate estimate (one player can own many squares); leave it for the
  // commissioner to estimate. All add-ons default off.
  estimatedPlayers: 0,
  addons: { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false },
  _tosAccepted: false,
};

export function CreateSquaresPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
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
    { id: 'grid', title: 'Matchup & grid', Component: StepSquaresDetails },
    { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="costPerSquare" feeLabel="Cost per square ($)" /> },
    { id: 'branding', title: 'Branding', Component: StepBranding },
    {
      id: 'launch', title: 'Launch', ownsSubmit: true,
      Component: () => (
        <LaunchStep
          uid={user.id}
          user={user}
          poolType="SQUARES"
          feeField="costPerSquare"
          createPool={createSquaresPool}
          onCreated={onComplete}
        />
      ),
    },
  ], [user, onComplete]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create a Squares pool</h1>
      </div>
      <WizardShell
        poolType="SQUARES"
        steps={steps}
        schema={squaresCreateInputSchema}
        defaultValues={seededDefaults}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          // Fallback only — LaunchStep owns the create → launch flow (see Bracket).
          onComplete(await createSquaresPool(values));
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
