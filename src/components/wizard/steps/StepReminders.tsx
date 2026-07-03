import { CheckboxField } from '../fields';

// Shared reminders step for the flat-flag reminder shape (Bracket / Playoff /
// NFL). Pools with the nested payment/lock/winner reminder shape (Squares,
// Props) supply their own reminder step via the wizard's step list.
export function StepReminders() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Reminders</h3>
      <p className="mb-5 text-sm text-slate-400">Automatic nudges so members don&apos;t miss the lock.</p>
      <CheckboxField name="reminders.auto24h" label="Remind players 24 hours before lock" />
      <CheckboxField name="reminders.auto1h" label="Remind players 1 hour before lock" />
      <CheckboxField name="reminders.autoLock" label="Auto-lock the pool at kickoff" />
      <CheckboxField name="reminders.announceWinner" label="Announce the winner automatically" />
    </div>
  );
}
