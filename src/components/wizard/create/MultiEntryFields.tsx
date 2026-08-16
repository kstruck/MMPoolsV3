import { useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { CheckboxField, NumberField } from '../fields';
import { MAX_ENTRIES_PER_USER_CAP, MULTI_ENTRY_WIZARD_ENABLED } from '@shared/multiEntry';

/**
 * Multiple entries per player (PLAN-MULTI-ENTRY D8, K2/K6). A Yes/No toggle;
 * the number field appears on Yes. The toggle is a wizard-only key
 * (`multiEntry`) — `buildNFLPayload` folds it into `settings.maxEntriesPerUser`
 * (toggle off ⇒ 1, whatever was typed), so a commissioner who tried it and
 * turned it back off cannot submit a stray value from a field they no longer see.
 * Raise-only after create; the setting is server-validated (1..CAP).
 */
export function MultiEntryFields() {
  const { watch, setValue, getValues } = useFormContext();
  const on = !!watch('multiEntry');
  // The wizard's zod resolver validates the RAW form values, and react-hook-form
  // keeps an unmounted field's value — so a stale 11 typed before turning the
  // toggle off would fail submit on a field the commissioner can no longer see.
  // Reset it to 1 the moment the toggle goes off; the builder does the same fold.
  // And the mirror (codex r1): the form default is 1, and HTML `min={2}` takes
  // no part in the zod submission check — so a commissioner who only ticks the
  // box and launches would persist a single-entry pool. Toggle ON ⇒ at least 2.
  useEffect(() => {
    if (!on) { setValue('settings.maxEntriesPerUser', 1, { shouldValidate: false }); return; }
    const cur = Number(getValues('settings.maxEntriesPerUser'));
    if (!Number.isFinite(cur) || cur < 2) setValue('settings.maxEntriesPerUser', 2, { shouldValidate: false });
  }, [on, setValue, getValues]);
  if (!MULTI_ENTRY_WIZARD_ENABLED) return null;
  return (
    <div className="mb-4 rounded-lg border border-line bg-page p-3">
      <CheckboxField name="multiEntry" label="Allow more than one entry per player" />
      {on && (
        <NumberField
          name="settings.maxEntriesPerUser"
          label="Max entries per player"
          min={2}
          max={MAX_ENTRIES_PER_USER_CAP}
          hint={`2 to ${MAX_ENTRIES_PER_USER_CAP}. Each entry pays the entry fee and competes on its own. You can raise this later while the pool is open, but never lower it.`}
        />
      )}
    </div>
  );
}
