import { TextField, CheckboxField } from '../fields';

export function StepBasics() {
  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Pool basics</h3>
      <p className="mb-5 text-sm text-slate-400">Name your pool and how members reach you.</p>
      <TextField name="name" label="Pool name" placeholder="Office March Madness" />
      <TextField name="managerName" label="Your name (commissioner)" placeholder="Optional" />
      <TextField name="contactEmail" label="Contact email" placeholder="you@example.com" />
      <CheckboxField name="isPublic" label="List this pool publicly" />
    </div>
  );
}
