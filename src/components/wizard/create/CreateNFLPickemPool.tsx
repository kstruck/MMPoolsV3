import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { pickemCreateInputSchema } from '@shared/schemas';
import {
  WizardShell, StepBasics, StepFeeAndPayment, StepBranding, StepReview,
} from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { TextField, SelectField, CheckboxField } from '../fields';
import type { WizardStepDef } from '../types';
import { buildNFLPayload } from './buildNFLPayload';

// NFL Pick'em-specific slot: season + lock/scoring modes.
function StepPickemRules() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Pick&apos;em rules</h3>
      <p className="mb-5 text-sm text-slate-400">Season and how picks lock and score.</p>
      <TextField name="season" label="Season" placeholder="2025" />
      <SelectField
        name="settings.lockMode"
        label="Lock mode"
        options={[
          { value: 'PER_GAME', label: 'Per game (each pick locks at its kickoff)' },
          { value: 'WEEKLY', label: 'Weekly (all picks lock at the first game)' },
        ]}
      />
      <SelectField
        name="settings.payoutMode"
        label="Payout mode"
        options={[
          { value: 'SEASON', label: 'Season-long' },
          { value: 'WEEKLY', label: 'Weekly' },
          { value: 'HYBRID', label: 'Hybrid' },
        ]}
      />
      <CheckboxField name="settings.confidenceMode" label="Confidence points (rank picks; forces weekly lock)" />
    </div>
  );
}

const steps: WizardStepDef[] = [
  { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
  { id: 'rules', title: "Pick'em rules", fields: ['season'], Component: StepPickemRules },
  { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
  { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
  { id: 'branding', title: 'Branding', Component: StepBranding },
  { id: 'review', title: 'Review', Component: () => <StepReview feeField="settings.entryFee" /> },
];

const defaultValues: Record<string, unknown> = {
  type: 'NFL_PICKEM',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  season: '2025',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  settings: {
    entryFee: 0,
    isListedPublic: true,
    lockMode: 'PER_GAME',
    payoutMode: 'SEASON',
    pickMode: 'STRAIGHT',
    lockBufferMinutes: 5,
    confidenceMode: false,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
  _tosAccepted: false,
};

export function CreateNFLPickemPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
  const { user, onComplete, onCancel } = props;
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create an NFL Pick&apos;em pool</h1>
      </div>
      <WizardShell
        poolType="NFL_PICKEM"
        steps={steps}
        schema={pickemCreateInputSchema}
        defaultValues={defaultValues}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          const poolId = await dbService.createNFLPool(buildNFLPayload(values, 'NFL_PICKEM'));
          onComplete(poolId);
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
