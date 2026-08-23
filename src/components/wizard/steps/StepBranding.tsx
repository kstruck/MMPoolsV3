import { useFormContext } from 'react-hook-form';
import { ColorField, TextField } from '../fields';
import { brandingStyles, DEFAULT_ACCENT } from '../../../utils/brandingStyles';

// Shared branding step (canonical superset: logoUrl + primary/secondary color).
// Wizards whose docs use different field names (bgColor vs backgroundColor) map
// on submit; the schemas accept both.
//
// PLAN-WIZARD-BUYFLOW-FIXES T1 (Kevin's issue 1): these two colours used to do
// nothing visible — `primaryColor` had no renderer at all, and `secondaryColor`
// drove a 2px tab underline. They now theme the pool page (see
// `src/utils/brandingStyles.ts`), so the labels say what each one does and the
// preview below shows it before the commissioner commits.
export function StepBranding() {
  const { watch } = useFormContext();
  const branding = watch('branding') as
    | { logoUrl?: string; primaryColor?: string; secondaryColor?: string }
    | undefined;
  const brand = brandingStyles(branding);

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Branding</h3>
      <p className="mb-1 text-sm text-slate-400">Optional — give your pool a look. You can change this later.</p>
      {/* T4/D1: branding used to sit behind a $29 "Custom branding" add-on that
          gated nothing. It is included with every pool; say so here, where the
          commissioner is deciding whether it costs them anything. */}
      <p className="mb-5 text-sm font-semibold text-emerald-400">Included with every pool — free on every plan.</p>

      <TextField name="branding.logoUrl" label="Logo URL" placeholder="https://…" />

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {/* Labelled by EFFECT. "Primary color" told a commissioner nothing about
            where it would land, which is half of why the feature read as broken. */}
        <ColorField
          name="branding.primaryColor"
          label="Primary color — header & buttons"
          placeholder="#4f46e5"
          fallback="#4f46e5"
        />
        <ColorField
          name="branding.secondaryColor"
          label="Accent color — highlights & active tabs"
          placeholder={DEFAULT_ACCENT}
          fallback={DEFAULT_ACCENT}
        />
      </div>

      {/* Live preview. Deliberately built from the SAME `brandingStyles` the pool
          page uses, so this cannot drift into promising a look the pool will not
          have — a mock-up with its own colours would be exactly that. */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p>
        <div className="rounded-lg border border-slate-700 p-3" style={brand.page}>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3" style={brand.headerCard}>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-bold text-white">
                {String(watch('name') || 'Your pool')}
              </span>
              <span
                className="rounded-md border px-3 py-1 text-xs font-bold text-white"
                style={brand.primaryButton}
              >
                Make Picks
              </span>
            </div>
            <div className="mt-3 flex gap-4 text-xs text-slate-400">
              <span className="border-b-2 pb-1 font-semibold text-white" style={brand.activeTabUnderline}>
                Dashboard
              </span>
              <span className="border-b-2 border-transparent pb-1">Standings</span>
              <span className="border-b-2 border-transparent pb-1">Rules</span>
            </div>
          </div>
        </div>
        {!brand.themed && (
          <p className="mt-1 text-xs text-slate-500">
            No primary colour set — your pool uses the standard theme.
          </p>
        )}
      </div>
    </div>
  );
}
