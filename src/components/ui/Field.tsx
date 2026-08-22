import React, { useId } from 'react';
import { cn } from './cn';
// Direct, not through the `ui` barrel: the barrel exports this file too.
import { HelpTip } from './HelpTip';

/* Form controls — cream fill, 1.5px line border, navy focus, red error.
   Labels: Saira Condensed 700 uppercase 12px tracking .08em. */

/**
 * `form` is omitted rather than destructured away: it is the one attribute that
 * is valid on a `<label>` and not on the `<span>` this renders when there is no
 * `htmlFor`, and dropping it from the type lets the rest be spread onto either
 * without a cast. Nothing in the codebase sets it.
 */
export interface FieldLabelProps
    extends Omit<React.LabelHTMLAttributes<HTMLLabelElement>, 'form'> {
    /**
     * The `HelpTopic` this control is explained by. Renders a `?` beside the
     * label text; omitted, nothing is rendered and the label is unchanged.
     *
     * There is no `text` prop and there must never be one — `HelpTip` takes an
     * id and nothing else, which is what keeps one explanation in one place.
     */
    helpId?: string;
    /**
     * Label colour. `default` is the body text colour; `muted` is the greyer
     * one every label on the NFL manager form has always used.
     *
     * A PROP RATHER THAN A `className` OVERRIDE, because `cn` here is a plain
     * join with no tailwind-merge: passing `text-muted` alongside the built-in
     * `text-[color:var(--text)]` emits BOTH, and which one wins is decided by
     * the order Tailwind happens to generate them in. One class, chosen here.
     *
     * Either way the class lands on the ROW, so the help tip inherits it.
     */
    tone?: 'default' | 'muted';
}

/**
 * A form label, with two things the plain `<label>` it replaces got wrong.
 * Both were settled in the wizard's own `LabelRow`
 * (`src/components/wizard/fields.tsx`) and are repeated here rather than
 * re-derived.
 *
 * 1. **The `HelpTip` is a SIBLING, never nested.** Its trigger is a
 *    `<button>`, and a labelable control inside a `<label>` is activated by
 *    clicking the label text — so nesting would make "click the field name"
 *    open a tooltip.
 *
 * 2. **With no `htmlFor` it renders a `<span>`, not a `<label>`.** A label
 *    associated with no control announces to a screen reader as a stray
 *    string. EVERY existing caller of this component is in exactly that state
 *    — `ContactPage`, `SupportPage`, `HowItWorksPage`, `PlayoffSettingsModal`
 *    and, until T4, all 33 of `NFLManagerView`'s — so this is a fix for them
 *    too, not only for the file that prompted it.
 *
 * The spacing moves from the label to the row wrapper (`mb-1.5`), so the gap
 * below a labelled control is unchanged whether or not a tip is present.
 */
export const FieldLabel: React.FC<FieldLabelProps> = ({
    className,
    helpId,
    htmlFor,
    tone = 'default',
    children,
    ...props
}) => {
    // COLOUR LIVES ON THE ROW, NOT ON THE LABEL. `HelpTip`'s trigger carries
    // no colour of its own (`text-current`) so that it inherits this one —
    // which makes the `?` exactly as visible as the label text it explains,
    // on every surface and in both themes. Put a colour back on the label
    // alone and the tip silently keeps whatever the row inherited instead.
    // `className` lands here for the same reason: every caller that passes one
    // passes a colour, and the tip has to follow it.
    const rowCls = cn(
        'mb-1.5 flex items-center gap-1.5',
        tone === 'muted' ? 'text-muted' : 'text-[color:var(--text)]',
        className
    );
    const textCls = 'font-display font-bold uppercase text-[12px] tracking-[0.08em]';
    return (
        <div className={rowCls}>
            {htmlFor
                ? <label htmlFor={htmlFor} className={textCls} {...props}>{children}</label>
                : <span className={textCls} {...props}>{children}</span>}
            {helpId ? <HelpTip helpId={helpId} /> : null}
        </div>
    );
};

const CONTROL_BASE =
    'w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] ' +
    'text-[color:var(--text)] placeholder:text-faint transition-colors ' +
    'focus:border-navy-600 focus:bg-surface focus:outline-none';

const CONTROL_ERROR = 'border-brandred-500 bg-[#FCEEED] focus:border-brandred-500 dark:text-ink';

export const FieldError: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
    className,
    ...props
}) => <p className={cn('mt-1.5 font-body text-[13px] text-brandred-600', className)} {...props} />;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ label, error, className, id, ...props }, ref) => {
        const autoId = useId();
        const inputId = id ?? autoId;
        return (
            <div>
                {label && <FieldLabel htmlFor={inputId}>{label}</FieldLabel>}
                <input
                    ref={ref}
                    id={inputId}
                    className={cn(CONTROL_BASE, error && CONTROL_ERROR, className)}
                    aria-invalid={error ? true : undefined}
                    {...props}
                />
                {error && <FieldError>{error}</FieldError>}
            </div>
        );
    }
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ label, error, className, id, children, ...props }, ref) => {
        const autoId = useId();
        const selectId = id ?? autoId;
        return (
            <div>
                {label && <FieldLabel htmlFor={selectId}>{label}</FieldLabel>}
                <select
                    ref={ref}
                    id={selectId}
                    className={cn(CONTROL_BASE, 'cursor-pointer', error && CONTROL_ERROR, className)}
                    aria-invalid={error ? true : undefined}
                    {...props}
                >
                    {children}
                </select>
                {error && <FieldError>{error}</FieldError>}
            </div>
        );
    }
);
Select.displayName = 'Select';

export interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
    className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, disabled, className }) => (
    <label className={cn('inline-flex items-center gap-3', disabled ? 'opacity-50' : 'cursor-pointer', className)}>
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150',
                checked ? 'bg-navy-800 dark:bg-gold-600' : 'bg-line'
            )}
        >
            <span
                className={cn(
                    'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-150',
                    checked && 'translate-x-5'
                )}
            />
        </button>
        {label && (
            <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">
                {label}
            </span>
        )}
    </label>
);

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    ({ label, className, id, ...props }, ref) => {
        const autoId = useId();
        const boxId = id ?? autoId;
        return (
            <label htmlFor={boxId} className={cn('inline-flex items-center gap-2.5 cursor-pointer', className)}>
                <span className="relative inline-flex">
                    <input
                        ref={ref}
                        id={boxId}
                        type="checkbox"
                        className={cn(
                            'peer appearance-none size-5 shrink-0 rounded-[5px] border-[1.5px] border-line bg-page',
                            'checked:bg-navy-800 checked:border-navy-800 transition-colors cursor-pointer',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600'
                        )}
                        {...props}
                    />
                    <svg
                        viewBox="0 0 12 12"
                        className="pointer-events-none absolute inset-0 size-5 p-[3px] text-white opacity-0 peer-checked:opacity-100 transition-opacity"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M2 6.5L4.5 9L10 3" />
                    </svg>
                </span>
                {label && <span className="font-body text-[15px] text-[color:var(--text)]">{label}</span>}
            </label>
        );
    }
);
Checkbox.displayName = 'Checkbox';

export interface RangeSliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: string;
}

/* ponytail: native range with gold accent; custom gold-foil track fill if pixel parity demanded later */
export const RangeSlider = React.forwardRef<HTMLInputElement, RangeSliderProps>(
    ({ label, className, id, ...props }, ref) => {
        const autoId = useId();
        const sliderId = id ?? autoId;
        return (
            <div>
                {label && <FieldLabel htmlFor={sliderId}>{label}</FieldLabel>}
                <input
                    ref={ref}
                    id={sliderId}
                    type="range"
                    className={cn('w-full accent-gold-600 cursor-pointer', className)}
                    {...props}
                />
            </div>
        );
    }
);
RangeSlider.displayName = 'RangeSlider';
