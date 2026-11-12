import { useMemo } from 'react';
import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { squaresCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, LaunchStep } from '../index';
import type { WizardStepDef } from '../types';
import { StepSquaresGame } from './StepSquaresGame';
import { StepSquaresPayouts } from './StepSquaresPayouts';
import { prefillFromUser } from './profilePrefill';
import { buildSquaresPayload } from './buildSquaresPayload';
import { PoolTypeGate } from '../../PoolTypeGate';

// Creates the SQUARES pool and RESOLVES its poolId (no navigation) for LaunchStep.
async function createSquaresPool(values: Record<string, unknown>): Promise<string> {
  return dbService.createPool(buildSquaresPayload(values));
}

const defaultValues: Record<string, unknown> = {
  type: 'SQUARES',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  homeTeam: '', awayTeam: '',
  // No game linked until one is picked on the matchup step.
  gameId: '',
  costPerSquare: 0, maxSquaresPerPlayer: 0, numberSets: '1', theme: 'default',
  // The even split is what the server creates a pool with when sent nothing;
  // it is the starting point here so the two agree.
  squaresPayouts: { q1: 25, half: 25, q3: 25, final: 25 },
  charity: { enabled: false, name: '', percentage: 0 },
  // Rollover ON, to the last winner, is what a squares pool on this site has
  // always started with (`createNewPool` in constants.ts). It is a choice the
  // commissioner now sees and can change, rather than one made for them.
  ruleVariations: { reverseWinners: false, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'last_winner' },
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
    { id: 'grid', title: 'Matchup & grid', Component: StepSquaresGame },
    { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="costPerSquare" feeLabel="Cost per square ($)" /> },
    { id: 'payouts', title: 'Payouts', fields: ['squaresPayouts'], Component: StepSquaresPayouts },
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

  // THE OFF SWITCH THAT NEEDS NO DEPLOY (`system/config.poolTypeFlags.SQUARES`).
  // The callable is what actually refuses a closed type; without this gate a
  // commissioner would fill in all six steps and be refused on the last one.
  return (
    <PoolTypeGate type="SQUARES">
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
    </PoolTypeGate>
  );
}
