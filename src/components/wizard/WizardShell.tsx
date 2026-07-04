import { useEffect, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { WizardShellProps } from './types';
import { useWizardDraft } from './useWizardDraft';

// Transient RHF field for the Review-step Terms acceptance. Underscore-prefixed
// so it reads as non-persisted; zod strips unknown keys so it never reaches the
// pool doc. The shell gates the final submit on it.
const TOS_FIELD = '_tosAccepted';

// Unified create/edit wizard shell: owns the RHF instance (zodResolver on the
// pool type's schema), step navigation with jump-to-visited, localStorage draft
// autosave, and the TOS-gated submit. Type-specific steps plug in via `steps`.
export function WizardShell(props: WizardShellProps) {
  const {
    poolType, steps, schema, defaultValues, userId,
    mode = 'create', seedId, submitLabel = 'Launch Pool', onSubmit, onCancel,
  } = props;

  const methods = useForm({
    // Shell is schema-generic; the concrete per-type schema is validated at the
    // callable too. Cast past zodResolver's invariant generic overload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues,
    mode: 'onTouched',
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftHandled, setDraftHandled] = useState(false);

  // Drafts only for a fresh create (never edit or clone/embed seeds).
  const draftEnabled = mode === 'create' && !seedId;
  const { existing, conflict, save, clear } = useWizardDraft({
    userId, poolType, mode, seedId, enabled: draftEnabled,
  });

  // Autosave every change (debounced by RHF's own batching).
  useEffect(() => {
    if (!draftEnabled) return;
    const sub = methods.watch((values) => save(values as Record<string, unknown>));
    return () => sub.unsubscribe();
  }, [methods, save, draftEnabled]);

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const tosAccepted = Boolean(methods.watch(TOS_FIELD));

  const goNext = async () => {
    setSubmitError(null);
    const ok = step.fields && step.fields.length > 0
      ? await methods.trigger(step.fields as never)
      : true;
    if (!ok) {
      // trigger() failing is otherwise silent — the button just does nothing,
      // identical class of bug as an unhandled final-submit validation failure.
      setSubmitError(`Please fix the highlighted fields before continuing: ${step.fields!.join(', ')}.`);
      return;
    }
    setStepIndex((i) => {
      const next = Math.min(i + 1, steps.length - 1);
      setMaxVisited((m) => Math.max(m, next));
      return next;
    });
  };

  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));
  const jumpTo = (i: number) => {
    if (i <= maxVisited) setStepIndex(i);
  };

  const submit = methods.handleSubmit(
    async () => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        // handleSubmit gates on validation, but its argument is the zod-STRIPPED
        // output (unknown keys removed) — that would drop legit config the schema
        // doesn't enumerate (reminders, teams, lockDate…). Use the full form state
        // instead; the callable re-gates and persists the original payload.
        const { [TOS_FIELD]: _tos, ...clean } = methods.getValues() as Record<string, unknown>;
        void _tos;
        await onSubmit(clean);
        clear();
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Something went wrong creating the pool.');
      } finally {
        setSubmitting(false);
      }
    },
    // handleSubmit validates the FULL schema on final submit, not just the
    // visible step — a field on an earlier step (or a form/schema type
    // mismatch) can fail validation invisibly, leaving the button inert with
    // no feedback. Surface it instead of failing silently.
    (errors) => {
      const badFields = Object.keys(errors).filter((k) => k !== TOS_FIELD);
      setSubmitError(
        badFields.length > 0
          ? `Some fields need attention before launching: ${badFields.join(', ')}. Check earlier steps.`
          : 'Please accept the Terms of Service to continue.',
      );
    },
  );

  const resumeDraft = () => {
    if (existing) methods.reset(existing.data);
    setDraftHandled(true);
  };
  const discardDraft = () => {
    clear();
    setDraftHandled(true);
  };

  return (
    <FormProvider {...methods}>
      <div className="mx-auto w-full max-w-2xl text-slate-100">
        {/* Draft resume prompt */}
        {draftEnabled && existing && !draftHandled && (
          <div className="mb-4 rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-4">
            <p className="text-sm font-semibold text-indigo-200">You have an unfinished pool draft.</p>
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={resumeDraft}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-semibold hover:bg-indigo-500">
                Resume
              </button>
              <button type="button" onClick={discardDraft}
                className="rounded-md px-4 py-1.5 text-sm font-semibold text-slate-300 hover:text-white">
                Start over
              </button>
            </div>
          </div>
        )}

        {conflict && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            This draft is open in another tab — changes here may be overwritten.
          </div>
        )}

        {/* Progress / step indicator */}
        <nav aria-label="Progress" className="mb-6 flex flex-wrap gap-2">
          {steps.map((s, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            const reachable = i <= maxVisited;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(i)}
                disabled={!reachable}
                aria-current={current ? 'step' : undefined}
                className={[
                  'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                  current ? 'bg-indigo-600 text-white'
                    : done ? 'bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30'
                      : reachable ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                        : 'cursor-not-allowed bg-slate-800 text-slate-500',
                ].join(' ')}
              >
                {i + 1}. {s.title}
              </button>
            );
          })}
        </nav>

        {/* Active step body */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <step.Component />
        </div>

        {submitError && (
          <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
            {submitError}
          </div>
        )}

        {/* Footer nav */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={stepIndex === 0 ? onCancel : goBack}
            disabled={stepIndex === 0 && !onCancel}
            className="rounded-md px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {stepIndex === 0 ? 'Cancel' : 'Back'}
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !tosAccepted}
              className="rounded-md bg-indigo-600 px-6 py-2 text-sm font-bold text-white shadow-lg hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Working…' : mode === 'edit' ? 'Save changes' : submitLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              className="rounded-md bg-indigo-600 px-6 py-2 text-sm font-bold text-white shadow-lg hover:bg-indigo-500"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </FormProvider>
  );
}
