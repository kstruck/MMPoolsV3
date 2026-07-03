// CreatePoolInput — PROPS. Goes through createPool with type='PROPS'
// (PropsWizard.tsx:136-162). props{cost,maxCards,questions} is the core config.
import { z } from 'zod';
import { contactFieldsSchema, brandingSchema } from './common';

export const propQuestionSchema = z.object({
  id: z.string().optional(),
  text: z.string().trim().min(1),
  options: z.array(z.string()).min(2).max(4),
  points: z.number().optional(),
  type: z.enum(['standard', 'tiebreaker']).optional(),
});

export const propsCreateInputSchema = contactFieldsSchema.extend({
  type: z.literal('PROPS'),
  name: z.string().trim().min(1, 'Pool name is required.'),
  props: z.object({
    cost: z.number().min(0),
    maxCards: z.number().int().min(1),
    payouts: z.array(z.number()).optional(),
    questions: z.array(propQuestionSchema).default([]),
  }),
  theme: z.string().optional(),
  branding: brandingSchema.optional(),
  gameId: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  seasonType: z.enum(['1', '2', '3']).optional(),
  week: z.number().int().optional(),
  date: z.number().optional(),
  gameTime: z.number().optional(),
});

export type PropsCreateInput = z.infer<typeof propsCreateInputSchema>;
