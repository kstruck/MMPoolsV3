// Runnable self-check for the CreatePoolInput schemas. node:assert, no framework.
// Compile shared/ then `node dist/__tests__/schemas.selfcheck.js`.
import assert from 'node:assert';
import { bracketCreateInputSchema } from '../schemas/bracket';
import { payoutsSchema, basicsSchema } from '../schemas/common';
import { getCreateInputSchema, hasCreateInputSchema } from '../schemas';

// 1. A valid bracket payload (as BracketWizard sends) parses.
const validBracket = {
  name: 'Office Madness',
  seasonYear: 2026,
  gender: 'mens' as const,
  tournamentType: 'ncaa' as const,
  settings: {
    entryFee: 20,
    scoringSystem: 'CLASSIC' as const,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
};
assert.doesNotThrow(() => bracketCreateInputSchema.parse(validBracket), 'valid bracket parses');

// 2. Empty name rejected.
assert.throws(
  () => bracketCreateInputSchema.parse({ ...validBracket, name: '' }),
  'empty name rejected',
);

// 3. seasonYear accepts number OR non-empty string.
assert.doesNotThrow(
  () => bracketCreateInputSchema.parse({ ...validBracket, seasonYear: '2026' }),
  'string seasonYear accepted',
);

// 4. Payouts over 100% rejected (places + bonuses summed).
assert.throws(
  () => payoutsSchema.parse({ places: [{ rank: 1, percentage: 80 }], bonuses: [{ percentage: 40 }] }),
  'over-100 payouts rejected',
);
assert.doesNotThrow(
  () => payoutsSchema.parse({ places: [{ rank: 1, percentage: 60 }], bonuses: [{ percentage: 40 }] }),
  'exactly-100 payouts accepted',
);

// 5. basics email validation.
assert.throws(() => basicsSchema.parse({ name: 'x', contactEmail: 'not-an-email' }), 'bad email rejected');
assert.doesNotThrow(() => basicsSchema.parse({ name: 'x', contactEmail: 'a@b.com' }), 'good email accepted');

// 6. Registry wiring: modeled vs pending.
assert.ok(getCreateInputSchema('BRACKET'), 'BRACKET schema registered');
assert.ok(hasCreateInputSchema('BRACKET'), 'BRACKET reported modeled');
assert.strictEqual(getCreateInputSchema('PROPS'), undefined, 'PROPS not yet modeled → undefined');
assert.strictEqual(hasCreateInputSchema('SQUARES'), false, 'SQUARES not yet modeled');

console.log('schemas.selfcheck: all assertions passed');
