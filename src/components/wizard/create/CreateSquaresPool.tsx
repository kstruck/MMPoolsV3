import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { squaresCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, StepReview } from '../index';
import { TextField, NumberField, SelectField } from '../fields';
import type { WizardStepDef } from '../types';
import { buildSquaresPayload } from './buildSquaresPayload';

// Squares-specific slot: the matchup + grid rules.
function StepSquaresDetails() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">The matchup &amp; grid</h3>
      <p className="mb-5 text-sm text-slate-400">Which teams, and how the grid works.</p>
      <div className="grid grid-cols-2 gap-x-4">
        <TextField name="homeTeam" label="Home team (rows)" placeholder="Chiefs" />
        <TextField name="awayTeam" label="Away team (columns)" placeholder="Eagles" />
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

const steps: WizardStepDef[] = [
  { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
  { id: 'grid', title: 'Matchup & grid', Component: StepSquaresDetails },
  { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="costPerSquare" feeLabel="Cost per square ($)" /> },
  { id: 'branding', title: 'Branding', Component: StepBranding },
  { id: 'review', title: 'Review', Component: () => <StepReview feeField="costPerSquare" /> },
];

const defaultValues: Record<string, unknown> = {
  type: 'SQUARES',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  homeTeam: '', awayTeam: '',
  costPerSquare: 0, maxSquaresPerPlayer: 0, numberSets: '1', gridSize: '10x10', theme: 'default',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  _tosAccepted: false,
};

export function CreateSquaresPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
  const { user, onComplete, onCancel } = props;
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create a Squares pool</h1>
      </div>
      <WizardShell
        poolType="SQUARES"
        steps={steps}
        schema={squaresCreateInputSchema}
        defaultValues={defaultValues}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          const poolId = await dbService.createPool(buildSquaresPayload(values));
          onComplete(poolId);
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
