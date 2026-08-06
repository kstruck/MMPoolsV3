import { useMemo } from 'react';
import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { survivorCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, LaunchStep } from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { ReadOnlyField, NumberField, CheckboxField, SelectField } from '../fields';
import { CURRENT_SEASON } from './currentSeason';
import type { WizardStepDef } from '../types';
import { buildNFLPayload } from './buildNFLPayload';

// Creates the NFL Survivor pool and RESOLVES its poolId (no navigation) for LaunchStep.
async function createSurvivorPool(values: Record<string, unknown>): Promise<string> {
  return dbService.createNFLPool(buildNFLPayload(values, 'NFL_SURVIVOR'));
}

function StepSurvivorRules() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Survivor rules</h3>
      <p className="mb-5 text-sm text-slate-400">Season, strikes, and buy-backs.</p>
      <ReadOnlyField
        label="Season"
        value={CURRENT_SEASON}
        hint="Pools are created for the current NFL season. Pick preseason, regular season or postseason below."
      />
      <SelectField
        name="seasonType"
        label="Season type"
        options={[
          { value: '1', label: 'Preseason' },
          { value: '2', label: 'Regular season' },
          { value: '3', label: 'Postseason' },
        ]}
      />
      <div className="grid grid-cols-2 gap-x-4">
        <NumberField name="settings.maxStrikes" label="Max strikes (0 = sudden death)" min={0} />
        <NumberField name="settings.maxRebuys" label="Max rebuys" min={0} />
        <NumberField name="settings.rebuyDeadlineWeek" label="Rebuy deadline week" min={0} />
        <NumberField name="settings.rebuyCost" label="Rebuy cost ($)" min={0} />
      </div>
      <CheckboxField name="settings.pickLosersMode" label="Pick teams to LOSE (reverse survivor)" />
      <CheckboxField name="settings.autoSurviveExemptionEnabled" label="Auto-survive when no eligible teams remain" />
    </div>
  );
}

const defaultValues: Record<string, unknown> = {
  type: 'NFL_SURVIVOR',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  season: CURRENT_SEASON,
  seasonType: '2',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  // Launch inputs (LaunchStep): player estimate + add-ons drive free vs trial.
  estimatedPlayers: 0,
  addons: { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false },
  settings: {
    entryFee: 0, isListedPublic: true,
    maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 4, rebuyCost: 0,
    pickLosersMode: false, autoSurviveExemptionEnabled: true,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
  _tosAccepted: false,
};

export function CreateNFLSurvivorPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
  const { user, onComplete, onCancel } = props;
  const steps: WizardStepDef[] = useMemo(() => [
    { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
    { id: 'rules', title: 'Survivor rules', Component: StepSurvivorRules },
    { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
    { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
    { id: 'branding', title: 'Branding', Component: StepBranding },
    {
      id: 'launch', title: 'Launch', ownsSubmit: true,
      Component: () => (
        <LaunchStep
          uid={user.id}
          poolType="NFL_SURVIVOR"
          feeField="settings.entryFee"
          createPool={createSurvivorPool}
          onCreated={onComplete}
        />
      ),
    },
  ], [user.id, onComplete]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create an NFL Survivor pool</h1>
      </div>
      <WizardShell
        poolType="NFL_SURVIVOR"
        steps={steps}
        schema={survivorCreateInputSchema}
        defaultValues={defaultValues}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          // Fallback only — LaunchStep owns the create → launch flow (see Bracket).
          onComplete(await createSurvivorPool(values));
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
