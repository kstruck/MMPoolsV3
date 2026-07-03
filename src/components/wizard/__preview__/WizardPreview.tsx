// TEMPORARY framework smoke-test harness (route: /__wizard_preview). Mounts the
// WizardShell with the real NFL_PLAYOFFS schema + shared steps and a STUB submit
// (no Firestore write). Lets us verify rendering / nav / validation / fee-reveal
// / payouts total / TOS gate in a browser without auth or DB. Delete before merge.
import { playoffCreateInputSchema } from '@shared/schemas';
import { WizardShell, StepBasics, StepFeeAndPayment, StepBranding, StepReminders, StepReview } from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { NumberField } from '../fields';
import type { WizardStepDef } from '../types';

function StepScoring() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Scoring</h3>
      <p className="mb-5 text-sm text-slate-400">Points multiplier for each playoff round.</p>
      <div className="grid grid-cols-2 gap-x-4">
        <NumberField name="settings.scoring.roundMultipliers.WILD_CARD" label="Wild Card" min={0} />
        <NumberField name="settings.scoring.roundMultipliers.DIVISIONAL" label="Divisional" min={0} />
        <NumberField name="settings.scoring.roundMultipliers.CONF_CHAMP" label="Conf. Championship" min={0} />
        <NumberField name="settings.scoring.roundMultipliers.SUPER_BOWL" label="Super Bowl" min={0} />
      </div>
    </div>
  );
}

const steps: WizardStepDef[] = [
  { id: 'basics', title: 'Basics', fields: ['name'], Component: StepBasics },
  { id: 'scoring', title: 'Scoring', Component: StepScoring },
  { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
  { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
  { id: 'branding', title: 'Branding', Component: StepBranding },
  { id: 'reminders', title: 'Reminders', Component: StepReminders },
  { id: 'review', title: 'Review', Component: () => <StepReview feeField="settings.entryFee" /> },
];

const defaultValues: Record<string, unknown> = {
  type: 'NFL_PLAYOFFS',
  name: '',
  managerName: '',
  contactEmail: '',
  isPublic: true,
  paymentInstructions: '',
  paymentHandles: { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  reminders: { auto24h: true, auto1h: true, autoLock: true, announceWinner: true },
  settings: {
    entryFee: 0,
    isListedPublic: true,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
    scoring: { roundMultipliers: { WILD_CARD: 1, DIVISIONAL: 2, CONF_CHAMP: 3, SUPER_BOWL: 4 } },
  },
  _tosAccepted: false,
};

export function WizardPreview() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">WizardShell preview — NFL Playoffs</h1>
        <p className="text-sm text-slate-500">Framework smoke test. Submit is stubbed (check the console).</p>
      </div>
      <WizardShell
        poolType="NFL_PLAYOFFS"
        steps={steps}
        schema={playoffCreateInputSchema}
        defaultValues={defaultValues}
        userId="preview-user"
        submitLabel="Launch (stub)"
        onSubmit={async (values) => {
          // eslint-disable-next-line no-console
          console.log('[WizardPreview] submit payload:', values);
          window.alert('Submit fired — see console for the validated payload.');
        }}
        onCancel={() => window.history.back()}
      />
    </div>
  );
}
