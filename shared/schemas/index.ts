// Per-type CreatePoolInput schema registry. All seven live pool types are
// modeled. The unified createPool uses these as validation GATES: .parse() to
// throw on invalid input, then persist the original (privilege-stripped)
// payload — unknown keys are legitimate per-type config, not errors.
//
// Payload sources: docs/wizard-unification/PHASE-A-INVENTORY.md §1 + the wizard
// build sites (SetupWizard, BracketWizard, PlayoffWizard, PropsWizard, NFLPoolWizard).
import type { ZodTypeAny } from 'zod';
import type { PoolType } from '../poolTypes';
import { squaresCreateInputSchema } from './squares';
import { bracketCreateInputSchema } from './bracket';
import { playoffCreateInputSchema } from './playoff';
import { propsCreateInputSchema } from './props';
import {
  pickemCreateInputSchema,
  survivorCreateInputSchema,
  marginCreateInputSchema,
} from './nfl';

const CREATE_INPUT_SCHEMAS: Record<PoolType, ZodTypeAny> = {
  SQUARES: squaresCreateInputSchema,
  BRACKET: bracketCreateInputSchema,
  NFL_PLAYOFFS: playoffCreateInputSchema,
  PROPS: propsCreateInputSchema,
  NFL_PICKEM: pickemCreateInputSchema,
  NFL_SURVIVOR: survivorCreateInputSchema,
  NFL_MARGIN: marginCreateInputSchema,
};

export function getCreateInputSchema(type: PoolType): ZodTypeAny | undefined {
  return CREATE_INPUT_SCHEMAS[type];
}

export function hasCreateInputSchema(type: PoolType): boolean {
  return type in CREATE_INPUT_SCHEMAS;
}

export * from './common';
export * from './squares';
export * from './bracket';
export * from './playoff';
export * from './props';
export * from './nfl';
export * from './quote';
