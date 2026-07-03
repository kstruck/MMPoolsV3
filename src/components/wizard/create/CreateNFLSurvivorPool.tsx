import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { survivorCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, StepReview } from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { TextField, NumberField, CheckboxField } from '../fields';
import type { WizardStepDef } from '../types';
import { buildNFLPayload } from './buildNFLPayload';

function StepSurvivorRules() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Survivor rules</h3>
      <p className="mb-5 text-sm text-slate-400">Season, strikes, and buy-backs.</p>
      <TextField name="season" label="Season" placeholder="2025" />
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

const steps: WizardStepDef[] = [
  { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
  { id: 'rules', title: 'Survivor rules', fields: ['season'], Component: StepSurvivorRules },
  { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
  { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
  { id: 'branding', title: 'Branding', Component: StepBranding },
  { id: 'review', title: 'Review', Component: () => <StepReview feeField="settings.entryFee" /> },
];

const defaultValues: Record<string, unknown> = {
  type: 'NFL_SURVIVOR',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  season: '2025',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
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
          const poolId = await dbService.createNFLPool(buildNFLPayload(values, 'NFL_SURVIVOR'));
          onComplete(poolId);
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
