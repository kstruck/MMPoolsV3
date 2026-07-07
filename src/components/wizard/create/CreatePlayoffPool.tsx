import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { playoffCreateInputSchema } from '@shared/schemas';
import {
  WizardShell, StepBasics, StepFeeAndPayment, StepBranding, StepReminders, LaunchStep,
} from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { TextField, NumberField, Field } from '../fields';
import type { WizardStepDef } from '../types';
import { buildPlayoffPayload } from './buildPlayoffPayload';

// Creates the NFL_PLAYOFFS pool and RESOLVES its poolId (no navigation) for LaunchStep.
async function createPlayoffPool(values: Record<string, unknown>): Promise<string> {
  return dbService.createPool(buildPlayoffPayload(values));
}

// Playoff-specific slot: season, lock date, and round scoring.
function StepPlayoffDetails() {
  const { register } = useFormContext();
  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Playoff details</h3>
      <p className="mb-5 text-sm text-slate-400">Season, lock time, and how each round scores.</p>
      <TextField name="season" label="Season" placeholder="2025" />
      <Field label="Lock date &amp; time" htmlFor="lockDate" hint="Picks lock at Wild Card kickoff by default.">
        <input id="lockDate" type="datetime-local" className={inputCls} {...register('lockDate')} />
      </Field>
      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Round multipliers</p>
      <div className="grid grid-cols-2 gap-x-4">
        <NumberField name="settings.scoring.roundMultipliers.WILD_CARD" label="Wild Card" min={0} />
        <NumberField name="settings.scoring.roundMultipliers.DIVISIONAL" label="Divisional" min={0} />
        <NumberField name="settings.scoring.roundMultipliers.CONF_CHAMP" label="Conf. Championship" min={0} />
        <NumberField name="settings.scoring.roundMultipliers.SUPER_BOWL" label="Super Bowl" min={0} />
      </div>
    </div>
  );
}

const defaultValues: Record<string, unknown> = {
  type: 'NFL_PLAYOFFS',
  name: '', managerName: '', contactEmail: '', isPublic: true,
  season: '2025', slug: '', lockDate: '',
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  reminders: { auto24h: true, auto1h: true, autoLock: true, announceWinner: true },
  // Launch inputs (LaunchStep): player estimate + add-ons drive free vs trial.
  estimatedPlayers: 0,
  addons: { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false },
  settings: {
    entryFee: 0,
    isListedPublic: true,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
    scoring: { roundMultipliers: { WILD_CARD: 1, DIVISIONAL: 2, CONF_CHAMP: 3, SUPER_BOWL: 4 } },
  },
  _tosAccepted: false,
};

export function CreatePlayoffPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
  const { user, onComplete, onCancel } = props;
  const steps: WizardStepDef[] = useMemo(() => [
    { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
    { id: 'details', title: 'Playoff details', fields: ['season'], Component: StepPlayoffDetails },
    { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
    { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
    { id: 'branding', title: 'Branding', Component: StepBranding },
    { id: 'reminders', title: 'Reminders', Component: StepReminders },
    {
      id: 'launch', title: 'Launch', ownsSubmit: true,
      Component: () => (
        <LaunchStep
          uid={user.id}
          poolType="NFL_PLAYOFFS"
          feeField="settings.entryFee"
          createPool={createPlayoffPool}
          onCreated={onComplete}
        />
      ),
    },
  ], [user.id, onComplete]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create a Playoff pool</h1>
      </div>
      <WizardShell
        poolType="NFL_PLAYOFFS"
        steps={steps}
        schema={playoffCreateInputSchema}
        defaultValues={defaultValues}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          // Fallback only — LaunchStep owns the create → launch flow (see Bracket).
          onComplete(await createPlayoffPool(values));
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
