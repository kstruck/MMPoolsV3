import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type { User } from '../../../types';
import { dbService } from '../../../services/dbService';
import { pickemCreateInputSchema } from '@shared/schemas';
import {
  WizardShell, StepBasics, StepFeeAndPayment, StepBranding, LaunchStep,
} from '../index';
import { StepPayouts } from '../steps/StepPayouts';
import { ReadOnlyField, SelectField, CheckboxField } from '../fields';
import { HybridSplitFields } from './HybridSplitFields';
import { MultiEntryFields } from './MultiEntryFields';
import { CURRENT_SEASON } from './currentSeason';
import type { WizardStepDef } from '../types';
import { prefillFromUser } from './profilePrefill';
import { buildNFLPayload } from './buildNFLPayload';

// Creates the NFL Pick'em pool and RESOLVES its poolId (no navigation) for LaunchStep.
async function createPickemPool(values: Record<string, unknown>): Promise<string> {
  return dbService.createNFLPool(buildNFLPayload(values, 'NFL_PICKEM'));
}

// NFL Pick'em-specific slot: season + lock/scoring modes.
function StepPickemRules() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Pick&apos;em rules</h3>
      <p className="mb-5 text-sm text-slate-400">Season and how picks lock and score.</p>
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
      <SelectField
        name="settings.pickMode"
        label="Scoring mode"
        options={[
          { value: 'STRAIGHT', label: 'Straight up — pick the winner, no point spread' },
          { value: 'ATS', label: 'Against the spread (ATS) — picks graded against the line' },
        ]}
        hint="Straight up is the default and needs no betting lines. ATS grades every pick against the game's spread, with a push scoring zero."
      />
      <HybridSplitFields />
      <AtsWarning />
      <SelectField
        name="settings.weeklyTiebreaker"
        label="Weekly tie-breaker"
        options={[
          { value: 'MNF_COMBINED', label: 'Monday night — combined score of ALL Monday games' },
          { value: 'MNF_LAST_GAME', label: 'Monday night — combined score of the LAST Monday game' },
          { value: 'NONE', label: 'None — tied weeks are shared' },
        ]}
        hint="Decides who wins a week when two players score the same. Players predict the number on their pick sheet. It cannot be changed once anyone has submitted picks, so pick it now."
      />
      <CheckboxField name="settings.confidenceMode" label="Confidence points (rank picks; forces weekly lock)" />
      <MultiEntryFields />
    </div>
  );
}

/**
 * ATS has a hard operational precondition and choosing it blind is a trap.
 *
 * `submitNFLPicks` refuses EVERY pick for the week unless all of that week's
 * games have `spread.locked === true` (`poolUsesSpreads`, scoped in #214). So an
 * ATS pool on a week with no betting lines is a pool nobody can enter — the
 * member sees "Spreads Not Yet Finalized" and can do nothing.
 *
 * That is not a rare edge: the 2026 PRESEASON feed carries a line on 1 of 49
 * games. A commissioner picking ATS for a preseason pool would lock their whole
 * room out, and the failure surfaces only later, to the members, not to them.
 *
 * Shown at the point of choice rather than documented elsewhere, because the
 * cost lands on someone who never saw the decision.
 */
function AtsWarning() {
  const { watch } = useFormContext();
  if (watch('settings.pickMode') !== 'ATS') return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
    >
      <p className="font-semibold">ATS needs locked spreads before anyone can pick.</p>
      <p className="mt-1 text-amber-200/80">
        Members cannot submit picks for a week until <strong>every</strong> game that week has a
        finalized spread. Preseason slates mostly have no betting line, so an ATS preseason pool
        will show <em>&ldquo;Spreads Not Yet Finalized&rdquo;</em> and accept nothing. Choose{' '}
        <strong>Straight up</strong> unless you are running a regular-season pool and will lock
        spreads each week.
      </p>
    </div>
  );
}

const defaultValues: Record<string, unknown> = {
  type: 'NFL_PICKEM',
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
    entryFee: 0,
    isListedPublic: true,
    lockMode: 'PER_GAME',
    payoutMode: 'SEASON',
    pickMode: 'STRAIGHT',
    // The historical rule, so a commissioner who never touches the control
    // creates the pool everyone already understands.
    weeklyTiebreaker: 'MNF_COMBINED',
    lockBufferMinutes: 5,
    confidenceMode: false,
    maxEntriesPerUser: 1,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
  _tosAccepted: false,
};

export function CreateNFLPickemPool(props: { user: User; onComplete: (poolId: string) => void; onCancel: () => void }) {
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
    { id: 'rules', title: "Pick'em rules", Component: StepPickemRules },
    { id: 'fee', title: 'Fee & Payment', Component: () => <StepFeeAndPayment feeField="settings.entryFee" /> },
    { id: 'payouts', title: 'Payouts', Component: () => <StepPayouts payoutsField="settings.payouts" /> },
    { id: 'branding', title: 'Branding', Component: StepBranding },
    {
      id: 'launch', title: 'Launch', ownsSubmit: true,
      Component: () => (
        <LaunchStep
          uid={user.id}
          user={user}
          poolType="NFL_PICKEM"
          feeField="settings.entryFee"
          createPool={createPickemPool}
          onCreated={onComplete}
        />
      ),
    },
  ], [user, onComplete]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Create an NFL Pick&apos;em pool</h1>
      </div>
      <WizardShell
        poolType="NFL_PICKEM"
        steps={steps}
        schema={pickemCreateInputSchema}
        defaultValues={seededDefaults}
        userId={user.id}
        submitLabel="Launch pool"
        onSubmit={async (values) => {
          // Fallback only — LaunchStep owns the create → launch flow (see Bracket).
          onComplete(await createPickemPool(values));
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
