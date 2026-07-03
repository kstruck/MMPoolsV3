// Per-type CreatePoolInput schema registry. Types not yet modeled return
// undefined; the unified createPool treats an undefined schema as "no
// server-side schema validation yet — fall back to the legacy per-type path"
// so migration is incremental and never blocks a create.
//
// Archaeology status (see docs/wizard-unification/PHASE-A-INVENTORY.md §6):
//   modeled:   BRACKET
//   pending:   SQUARES, NFL_PLAYOFFS, PROPS, NFL_PICKEM, NFL_SURVIVOR, NFL_MARGIN
import type { ZodTypeAny } from 'zod';
import type { PoolType } from '../poolTypes';
import { bracketCreateInputSchema } from './bracket';

const CREATE_INPUT_SCHEMAS: Partial<Record<PoolType, ZodTypeAny>> = {
  BRACKET: bracketCreateInputSchema,
};

export function getCreateInputSchema(type: PoolType): ZodTypeAny | undefined {
  return CREATE_INPUT_SCHEMAS[type];
}

export function hasCreateInputSchema(type: PoolType): boolean {
  return type in CREATE_INPUT_SCHEMAS;
}

export * from './common';
export * from './bracket';
