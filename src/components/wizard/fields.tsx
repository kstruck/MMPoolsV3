import type { ReactNode } from 'react';
import { useFormContext, type FieldErrors } from 'react-hook-form';

// RHF-connected field primitives shared by every wizard step. Field `name`
// accepts dot paths (e.g. "settings.entryFee", "paymentHandles.venmo").

function errorAt(errors: FieldErrors, path: string): string | undefined {
  const node = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), errors);
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : undefined;
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400';

export function Field(props: { label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode }) {
  const { label, htmlFor, error, hint, children } = props;
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  );
}

/**
 * A labelled value the commissioner can SEE but not change.
 *
 * Not a disabled `<input>`: a greyed-out box still reads as "a field I might be
 * able to enable", and a disabled input is skipped by keyboard navigation, so
 * a keyboard or screen-reader user would never encounter the value at all.
 * This renders plain text that is in the tab order of nothing and in the
 * reading order of everything.
 *
 * It is deliberately NOT registered with react-hook-form — the value it shows
 * comes from `defaultValues` and no user action can alter it.
 */
export function ReadOnlyField(props: { label: string; value: string; hint?: string }) {
  const { label, value, hint } = props;
  return (
    <Field label={label} hint={hint}>
      <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm font-semibold text-white">
        {value}
      </p>
    </Field>
  );
}

export function TextField(props: { name: string; label: string; placeholder?: string; hint?: string }) {
  const { name, label, placeholder, hint } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} hint={hint}>
      <input id={name} placeholder={placeholder} className={inputCls} {...register(name)} />
    </Field>
  );
}

export function NumberField(props: { name: string; label: string; placeholder?: string; hint?: string; min?: number }) {
  const { name, label, placeholder, hint, min } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} hint={hint}>
      <input id={name} type="number" min={min} placeholder={placeholder} className={inputCls} {...register(name, { valueAsNumber: true })} />
    </Field>
  );
}

export function TextAreaField(props: { name: string; label: string; placeholder?: string; hint?: string; rows?: number }) {
  const { name, label, placeholder, hint, rows = 3 } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} hint={hint}>
      <textarea id={name} rows={rows} placeholder={placeholder} className={inputCls} {...register(name)} />
    </Field>
  );
}

export function SelectField(props: { name: string; label: string; options: { value: string; label: string }[]; hint?: string }) {
  const { name, label, options, hint } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} hint={hint}>
      <select id={name} className={inputCls} {...register(name)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

// `label` is a ReactNode, not a string, so a caller can put a link inside it —
// the Terms of Service gate on LaunchStep needs one. A link nested in a <label>
// still activates the label's control on click, so any such caller must
// stopPropagation on the anchor or reading the terms silently ticks the box.
export function CheckboxField(props: { name: string; label: ReactNode }) {
  const { name, label } = props;
  const { register } = useFormContext();
  return (
    <label className="mb-2 flex items-center gap-2 text-sm text-slate-200">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500" {...register(name)} />
      {label}
    </label>
  );
}
