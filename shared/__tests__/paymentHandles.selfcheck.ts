// Runnable self-check for the payment-handle adapter. Node's built-in assert,
// no framework — compile shared/ then `node dist/__tests__/paymentHandles.test.js`.
import assert from 'node:assert';
import {
  readPaymentHandles,
  writePaymentHandles,
  CLEAR,
} from '../paymentHandles';

// 1. Legacy top-level only (Squares/NFL shape) → read canonically.
assert.deepStrictEqual(
  readPaymentHandles({ venmo: 'v1', zelle: 'z1' }),
  { venmo: 'v1', zelle: 'z1' },
  'reads legacy top-level fields',
);

// 2. Nested wins over legacy per-field.
assert.deepStrictEqual(
  readPaymentHandles({ venmo: 'old', paymentHandles: { venmo: 'new', cashapp: 'c' } }),
  { venmo: 'new', cashapp: 'c' },
  'nested overrides legacy top-level',
);

// 3. googlePay is nested-only.
assert.deepStrictEqual(
  readPaymentHandles({ paymentHandles: { googlePay: 'g' } }),
  { googlePay: 'g' },
  'reads nested googlePay',
);
assert.deepStrictEqual(
  readPaymentHandles({ googlePay: 'g' } as never),
  {},
  'ignores a top-level googlePay (no legacy field exists)',
);

// 4. Blank/whitespace handles are dropped, values trimmed.
assert.deepStrictEqual(
  readPaymentHandles({ venmo: '  ', zelle: '  z  ' }),
  { zelle: 'z' },
  'drops blank, trims value',
);

// 5. Write dual-writes legacy top-level and CLEARs absent handles.
assert.deepStrictEqual(
  writePaymentHandles({ venmo: 'v', googlePay: 'g' }),
  {
    paymentHandles: { venmo: 'v', googlePay: 'g' },
    venmo: 'v',
    zelle: CLEAR,
    cashapp: CLEAR,
    paypal: CLEAR,
  },
  'write dual-writes present + CLEARs absent legacy fields',
);

// 6. Round-trip: the canonical nested object survives a write unchanged.
const input = { venmo: 'v', zelle: 'z', cashapp: 'c', paypal: 'p', googlePay: 'g' };
assert.deepStrictEqual(
  writePaymentHandles(input).paymentHandles,
  input,
  'round-trips all five handles through the canonical nested object',
);

console.log('paymentHandles.selfcheck: all assertions passed');
