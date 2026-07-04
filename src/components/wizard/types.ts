import type { ComponentType } from 'react';
import type { ZodTypeAny } from 'zod';
import type { PoolType } from '@shared/poolTypes';

// One step in a unified create/edit wizard. `fields` are the RHF field paths the
// step owns — validated on Next via trigger(). A step with no fields skips
// per-step validation (e.g. the Review step).
export interface WizardStepDef {
  id: string;
  title: string;
  fields?: string[];
  Component: ComponentType;
}

export type WizardMode = 'create' | 'edit';

export interface WizardShellProps {
  poolType: PoolType;
  steps: WizardStepDef[];
  // The pool type's CreatePoolInput schema (or an edit schema), used as the RHF
  // zodResolver. Client validation is UX; the callable re-validates server-side.
  schema: ZodTypeAny;
  defaultValues: Record<string, unknown>;
  // Drives the per-user draft key; keeps drafts from colliding across accounts.
  userId: string;
  mode?: WizardMode;
  // Present when seeding from clone/edit/embed — suppresses draft auto-resume.
  seedId?: string;
  embedded?: boolean;
  submitLabel?: string;
  // Receives the RHF-validated values; throws to surface an error in the shell.
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}
