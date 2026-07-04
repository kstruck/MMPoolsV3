// Runnable self-check for the CreatePoolInput schemas. node:assert, no framework.
// Compile shared/ then `node dist/__tests__/schemas.selfcheck.js`.
import assert from 'node:assert';
import { payoutsSchema, basicsSchema } from '../schemas/common';
import {
  getCreateInputSchema,
  hasCreateInputSchema,
  bracketCreateInputSchema,
  squaresCreateInputSchema,
  propsCreateInputSchema,
  playoffCreateInputSchema,
  pickemCreateInputSchema,
  survivorCreateInputSchema,
  marginCreateInputSchema,
} from '../schemas';
import { POOL_TYPES } from '../poolTypes';

// --- Shared sub-schemas -----------------------------------------------------
assert.throws(
  () => payoutsSchema.parse({ places: [{ rank: 1, percentage: 80 }], bonuses: [{ percentage: 40 }] }),
  'over-100 payouts rejected',
);
assert.doesNotThrow(
  () => payoutsSchema.parse({ places: [{ rank: 1, percentage: 60 }], bonuses: [{ name: 'Upset', percentage: 40 }] }),
  'exactly-100 payouts (named bonus) accepted',
);
assert.throws(() => basicsSchema.parse({ name: 'x', contactEmail: 'nope' }), 'bad email rejected');

// --- Every type: a representative valid payload parses -----------------------
const okPayouts = { places: [{ rank: 1, percentage: 100 }], bonuses: [] };

assert.doesNotThrow(
  () => squaresCreateInputSchema.parse({ name: 'Big Game', costPerSquare: 10, venmo: '@host' }),
  'squares parses',
);
assert.throws(
  () => squaresCreateInputSchema.parse({ name: 'Big Game' }),
  'squares missing costPerSquare rejected',
);

assert.doesNotThrow(
  () => bracketCreateInputSchema.parse({ name: 'Madness', seasonYear: 2026, settings: { entryFee: 20, payouts: okPayouts } }),
  'bracket parses',
);

assert.doesNotThrow(
  () => playoffCreateInputSchema.parse({
    type: 'NFL_PLAYOFFS', name: 'Playoff Bracket',
    settings: { entryFee: 25, payouts: okPayouts, scoring: { roundMultipliers: { WILD_CARD: 1, DIVISIONAL: 2, CONF_CHAMP: 3, SUPER_BOWL: 4 } } },
  }),
  'playoff parses',
);
assert.throws(
  () => playoffCreateInputSchema.parse({ type: 'NFL_PLAYOFFS', name: 'x', settings: { entryFee: 25, payouts: okPayouts } }),
  'playoff missing scoring rejected',
);

// lockDate is shared by the client resolver (raw datetime-local string / blank)
// and the server gate (already-converted millis) — both shapes must parse.
const playoffScoring = { WILD_CARD: 1, DIVISIONAL: 2, CONF_CHAMP: 3, SUPER_BOWL: 4 };
const playoffBase = { type: 'NFL_PLAYOFFS', name: 'x', settings: { entryFee: 0, payouts: okPayouts, scoring: { roundMultipliers: playoffScoring } } };
assert.strictEqual(
  playoffCreateInputSchema.parse({ ...playoffBase, lockDate: '' }).lockDate,
  undefined,
  'blank lockDate coerces to undefined',
);
assert.strictEqual(
  playoffCreateInputSchema.parse({ ...playoffBase, lockDate: '2026-01-10T18:00' }).lockDate,
  new Date('2026-01-10T18:00').getTime(),
  'datetime-local lockDate string parses to millis',
);
assert.strictEqual(
  playoffCreateInputSchema.parse({ ...playoffBase, lockDate: 1767034800000 }).lockDate,
  1767034800000,
  'already-millis lockDate passes through',
);

assert.doesNotThrow(
  () => propsCreateInputSchema.parse({
    type: 'PROPS', name: 'SB Props',
    props: { cost: 5, maxCards: 3, questions: [{ text: 'Coin toss?', options: ['H', 'T'] }] },
  }),
  'props parses',
);
assert.throws(
  () => propsCreateInputSchema.parse({ type: 'PROPS', name: 'x', props: { cost: 5, maxCards: 3, questions: [{ text: 'q', options: ['only-one'] }] } }),
  'props question with <2 options rejected',
);

assert.doesNotThrow(
  () => pickemCreateInputSchema.parse({ type: 'NFL_PICKEM', name: 'Weekly', season: '2026', settings: { entryFee: 10, payouts: okPayouts } }),
  'pickem parses',
);
assert.throws(
  () => pickemCreateInputSchema.parse({ type: 'NFL_PICKEM', name: 'Weekly', settings: { entryFee: 10, payouts: okPayouts } }),
  'pickem missing season rejected',
);

assert.doesNotThrow(
  () => survivorCreateInputSchema.parse({ type: 'NFL_SURVIVOR', name: 'Last Man', season: '2026', settings: { entryFee: 20, payouts: okPayouts, maxStrikes: 1, maxRebuys: 0 } }),
  'survivor parses',
);

assert.doesNotThrow(
  () => marginCreateInputSchema.parse({ type: 'NFL_MARGIN', name: 'Margins', season: '2026', settings: { entryFee: 15, payouts: okPayouts } }),
  'margin parses',
);

// --- Registry: every live pool type is modeled ------------------------------
for (const t of POOL_TYPES) {
  assert.ok(hasCreateInputSchema(t), `registry has schema for ${t}`);
  assert.ok(getCreateInputSchema(t), `registry returns schema for ${t}`);
}

console.log('schemas.selfcheck: all assertions passed');
