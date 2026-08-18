import { TextField } from '../fields';

// Shared branding step (canonical superset: logoUrl + primary/secondary color).
// Wizards whose docs use different field names (bgColor vs backgroundColor) map
// on submit; the schemas accept both.
export function StepBranding() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Branding</h3>
      <p className="mb-5 text-sm text-slate-400">Optional — give your pool a look. You can change this later.</p>
      <TextField name="branding.logoUrl" label="Logo URL" placeholder="https://…" />
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <TextField name="branding.primaryColor" label="Primary color" placeholder="#4f46e5" />
        <TextField name="branding.secondaryColor" label="Accent color" placeholder="#0ea5e9" />
      </div>
    </div>
  );
}
