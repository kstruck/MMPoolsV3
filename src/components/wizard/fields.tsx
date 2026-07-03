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

export function CheckboxField(props: { name: string; label: string }) {
  const { name, label } = props;
  const { register } = useFormContext();
  return (
    <label className="mb-2 flex items-center gap-2 text-sm text-slate-200">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500" {...register(name)} />
      {label}
    </label>
  );
}
