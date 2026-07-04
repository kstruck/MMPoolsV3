import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { marginCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, StepReview } from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { TextField, SelectField } from '../fields';
import type { WizardStepDef } from '../types';
import { buildNFLPayload } from './buildNFLPayload';

function StepMarginRules() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Margin rules</h3>
      <p className="mb-5 text-sm text-slate-400">Season and payout cadence.</p>
      <TextField name="season" label="Season" placeholder="2025" />
      <SelectField
        name="settings.payoutMode"
        label="Payout mode"
        options={[
          { value: 'SEASON', label: 'Season-long' },
          { value: 'WEEKLY', label: 'Weekly' },
          { value: 'HYBRID', label: 'Hybrid' },
        ]}
      />
    </div>
  );
}

const steps: WizardStepDef[] = [
  { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
  { id: 'rules', title: 'Margin rules', fields: ['season'], Component: StepMarginRules },
  { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
  { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
  { id: 'branding', title: 'Branding', Component: StepBranding },
  { id: 'review', title: 'Review', Component: () => <StepReview feeField="settings.entryFee" /> },
];

const defaultValues: Record<string, unknown> = {
  type: 'NFL_MARGIN',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  season: '2025',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  settings: {
    entryFee: 0, isListedPublic: true, payoutMode: 'SEASON',
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
  _tosAccepted: false,
};

export function CreateNFLMarginPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
  const { user, onComplete, onCancel } = props;
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create an NFL Margin pool</h1>
      </div>
      <WizardShell
        poolType="NFL_MARGIN"
        steps={steps}
        schema={marginCreateInputSchema}
        defaultValues={defaultValues}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          const poolId = await dbService.createNFLPool(buildNFLPayload(values, 'NFL_MARGIN'));
          onComplete(poolId);
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
