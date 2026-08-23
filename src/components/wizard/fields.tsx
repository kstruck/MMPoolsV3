import type { ReactNode } from 'react';
import { useFormContext, type FieldErrors } from 'react-hook-form';
import { HelpTip } from '../ui/HelpTip';
import { isValidHex, normalizeHex } from '../../utils/brandingStyles';

// RHF-connected field primitives shared by every wizard step. Field `name`
// accepts dot paths (e.g. "settings.entryFee", "paymentHandles.venmo").
//
// PLAN-HELP-SYSTEM T1: the `hint` prop is GONE. Every explanation of what an
// option does is a `HelpTopic`, rendered by the `HelpTip` beside the label —
// a `hint=` string at the call site is a second place to write help copy, and
// the whole registry exists so there is only one. `helpId` defaults to `name`,
// so a typed field needs no extra prop; the raw `register()` / `Controller`
// call sites that bypass these components pass one explicitly.

function errorAt(errors: FieldErrors, path: string): string | undefined {
  const node = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), errors);
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : undefined;
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500';
// No colour: `LabelRow` puts it on the row so the `HelpTip` beside the label
// inherits the same one (see `HelpTip`'s trigger — it is `text-current`).
const labelCls = 'text-xs font-semibold uppercase tracking-wide';

/**
 * The label row: the label and, as a SIBLING, the help trigger.
 *
 * Never nested. The `HelpTip` trigger is a `<button>`, and a labelable control
 * inside a `<label>` is activated by clicking the label text — so nesting it
 * would make "click the field name" open a tooltip.
 *
 * With no `htmlFor` it renders a `<span>`, not a `<label>`: a label associated
 * with no control announces as a stray string. `ReadOnlyField` depends on that.
 *
 * THE COLOUR IS ON THE ROW, not on the label, so the tip inherits it and is
 * exactly as visible as the label beside it. This wizard is a fixed dark
 * palette on a themed page, so no theme token would have worked here.
 */
function LabelRow(props: { label: ReactNode; htmlFor?: string; helpId?: string }) {
  const { label, htmlFor, helpId } = props;
  return (
    <div className="mb-1 flex items-center gap-1.5 text-slate-400">
      {htmlFor
        ? <label htmlFor={htmlFor} className={labelCls}>{label}</label>
        : <span className={labelCls}>{label}</span>}
      {helpId ? <HelpTip helpId={helpId} /> : null}
    </div>
  );
}

export function Field(props: { label: string; htmlFor?: string; error?: string; helpId?: string; children: ReactNode }) {
  const { label, htmlFor, error, helpId, children } = props;
  return (
    <div className="mb-4">
      <LabelRow label={label} htmlFor={htmlFor} helpId={helpId} />
      {children}
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
export function ReadOnlyField(props: { label: string; value: string; helpId?: string }) {
  const { label, value, helpId } = props;
  // No `htmlFor`, so `LabelRow` renders a <span>: there is no control to
  // associate a <label> with, and a stray one announces as loose text.
  return (
    <div className="mb-4">
      <LabelRow label={label} helpId={helpId} />
      <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

export function TextField(props: { name: string; label: string; placeholder?: string; helpId?: string }) {
  const { name, label, placeholder, helpId } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} helpId={helpId ?? name}>
      <input id={name} placeholder={placeholder} className={inputCls} {...register(name)} />
    </Field>
  );
}

export function NumberField(props: { name: string; label: string; placeholder?: string; helpId?: string; min?: number; max?: number }) {
  const { name, label, placeholder, helpId, min, max } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} helpId={helpId ?? name}>
      <input id={name} type="number" min={min} max={max} placeholder={placeholder} className={inputCls} {...register(name, { valueAsNumber: true })} />
    </Field>
  );
}

export function TextAreaField(props: { name: string; label: string; placeholder?: string; helpId?: string; rows?: number }) {
  const { name, label, placeholder, helpId, rows = 3 } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} helpId={helpId ?? name}>
      <textarea id={name} rows={rows} placeholder={placeholder} className={inputCls} {...register(name)} />
    </Field>
  );
}

export function SelectField(props: { name: string; label: string; options: { value: string; label: string }[]; helpId?: string }) {
  const { name, label, options, helpId } = props;
  const { register, formState: { errors } } = useFormContext();
  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} helpId={helpId ?? name}>
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
//
// The HelpTip sits OUTSIDE the <label> for the same reason (see LabelRow): its
// trigger is a <button>, and clicking the checkbox's own label must tick the
// box, not open a tooltip.
export function CheckboxField(props: { name: string; label: ReactNode; helpId?: string }) {
  const { name, label, helpId } = props;
  const { register } = useFormContext();
  return (
    <div className="mb-2 flex items-center gap-1.5 text-slate-200">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500" {...register(name)} />
        {label}
      </label>
      <HelpTip helpId={helpId ?? name} />
    </div>
  );
}

/**
 * A hex colour: a native swatch picker and the hex text, bound to ONE RHF value
 * (PLAN-WIZARD-BUYFLOW-FIXES T1).
 *
 * Two controls, one field, because neither alone is enough: the picker cannot
 * express "leave it unset", and the text box let a commissioner type `blue` or
 * `#12` and silently style nothing — which is a large part of why branding
 * colours read as broken. The text box stays authoritative and validates; the
 * picker just writes a valid value into it.
 *
 * `<input type="color">` has no empty state — it shows `#000000` for anything
 * it cannot parse — so the swatch falls back to `fallback` for display while
 * the STORED value stays empty. Reading the swatch as if it were the value
 * would turn "no colour chosen" into "black chosen" for every pool.
 */
export function ColorField(props: {
  name: string;
  label: string;
  placeholder?: string;
  helpId?: string;
  /** What the swatch shows while the field is empty. Never written to the form. */
  fallback: string;
}) {
  const { name, label, placeholder, helpId, fallback } = props;
  const { register, setValue, watch, formState: { errors } } = useFormContext();
  const raw = watch(name);
  const current = typeof raw === 'string' ? raw.trim() : '';
  const valid = isValidHex(current);
  const swatch = valid ? normalizeHex(current)! : fallback;

  return (
    <Field label={label} htmlFor={name} error={errorAt(errors, name)} helpId={helpId ?? name}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} — colour picker`}
          value={swatch}
          onChange={(e) => setValue(name, e.target.value, { shouldDirty: true, shouldValidate: true })}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-700 bg-slate-950 p-1"
        />
        <input
          id={name}
          placeholder={placeholder}
          className={inputCls}
          {...register(name)}
        />
      </div>
      {current && !valid && (
        <p className="mt-1 text-xs text-amber-300">
          Use a hex colour like <code>#4f46e5</code>. Anything else is ignored and the pool keeps the default.
        </p>
      )}
    </Field>
  );
}
