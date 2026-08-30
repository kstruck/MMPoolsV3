import React from 'react';
import { cn } from './cn';

export interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /**
     * THE ACCESSIBLE NAME, AND IT IS REQUIRED.
     *
     * This is the whole reason the component exists rather than being a nicety
     * on top of the de-duplication. Every hand-rolled copy of this toggle wrapped
     * a `<label>` around nothing but the visually-hidden checkbox and the
     * decorative track — the words a sighted person reads ("Manual Score
     * Override", "Public Visibility", "Enable Charity Donation") were in a
     * SIBLING heading, outside the label. A `<label>` with no text gives the
     * control it wraps no name, so all five announced as a bare "checkbox,
     * unchecked", and the setting being toggled was unknowable without sight.
     *
     * Making it a required prop means the next toggle cannot be added without
     * one. TypeScript is the guard for the shape; `tests/a11y-invariants.test.ts`
     * is the guard for "no file re-rolls its own".
     */
    label: string;
    /**
     * Longer text a sighted user reads next to the switch — the sub-line under
     * the heading, where there is one. Referenced by id rather than folded into
     * `label` so the name stays short in a screen reader's control list, which
     * is where a name is most often heard on its own.
     */
    describedById?: string;
    disabled?: boolean;
    /**
     * The checked track colour. `navy` is the default the four wizard toggles
     * use (`peer-checked:bg-navy-800 dark:peer-checked:bg-gold-600`); `gold` is
     * the one `AdminPanel`'s two use (`peer-checked:bg-gold-500`).
     *
     * A PROP, NOT A `className` OVERRIDE, for the reason `FieldLabel.tone`
     * gives: `cn` here is a plain join with no tailwind-merge, so passing a
     * second `peer-checked:bg-*` emits BOTH and which one wins is decided by
     * the order Tailwind happens to generate them in.
     */
    tone?: 'navy' | 'gold';
    className?: string;
}

/**
 * The toggle switch, in one place.
 *
 * It was copied five times across `AdminPanel.tsx`, `WizardStepBasics.tsx`,
 * `WizardStepPayouts.tsx` and `WizardStepSideHustle.tsx` — the same ~500
 * character class string each time, with two different checked colours and no
 * accessible name on any of them. `UserProfile.tsx` has a sixth toggle of a
 * DIFFERENT shape (its label carries visible text, so it is named) and is
 * deliberately left alone; see `tests/a11y-invariants.test.ts`.
 *
 * ⚠️ THE `<label>` LIVES HERE AND NOWHERE ELSE. PLAN-HELP-SYSTEM T4–T7 require
 * zero raw `<label` in the manager and wizard files, because a raw one is both a
 * control with no route to a help topic and — on these forms — a label bound to
 * nothing. A switch genuinely needs a `<label>` to associate by nesting, so the
 * rule is satisfied by having exactly one home for it, the same way `FieldLabel`
 * is the one home for a field's label.
 *
 * The visually-hidden `<input type="checkbox">` is kept rather than a
 * `role="switch"` `<button>`: it is a real form control, it is already what
 * every call site passes state to, and the `peer-*` classes that draw the track
 * are written against its `:checked` and `:focus-visible` states.
 */
export const Switch: React.FC<SwitchProps> = ({
    checked,
    onChange,
    label,
    describedById,
    disabled = false,
    tone = 'navy',
    className,
}) => (
    <label className={cn('relative inline-flex items-center', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', className)}>
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            aria-label={label}
            aria-describedby={describedById}
            className="sr-only peer"
        />
        {/* Decorative: the name is on the input above, so this is hidden from
            the accessibility tree rather than being read as an empty group. */}
        <div
            aria-hidden="true"
            className={cn(
                "w-11 h-6 bg-line peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-gold-500 peer-focus-visible:ring-offset-1 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all",
                tone === 'gold' ? 'peer-checked:bg-gold-500' : 'peer-checked:bg-navy-800 dark:peer-checked:bg-gold-600',
            )}
        />
    </label>
);
