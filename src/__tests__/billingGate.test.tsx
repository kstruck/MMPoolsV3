/**
 * billingGate.test.tsx — Component tests for BillingGate
 *
 * Tests rendering behavior across all billing states:
 * - free / active → children only, no banner
 * - trial → children + trial countdown banner
 * - grace_period → children + amber warning banner
 * - locked → blur overlay + modal, children blurred
 * - undefined billing → treated as free
 *
 * Runner: vitest + @testing-library/react
 *
 * NOTE: If @testing-library/react is not installed, run:
 *   npm install --save-dev @testing-library/react @testing-library/jest-dom
 */

import { describe, it, expect, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock framer-motion before importing the component
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, style, ...props }: any) => (
      <div style={style} {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Lock: () => <span data-testid="icon-lock">🔒</span>,
  AlertTriangle: () => <span data-testid="icon-alert">⚠️</span>,
  CreditCard: () => <span data-testid="icon-credit">💳</span>,
  Clock: () => <span data-testid="icon-clock">🕐</span>,
  ExternalLink: () => <span data-testid="icon-link">🔗</span>,
  CheckCircle2: () => <span data-testid="icon-paid">✅</span>,
}));

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingGate } from '../components/billing/BillingGate';
import type { PoolBilling } from '../types';

let lastMarkup = '';
const render = (ui: React.ReactElement) => {
  lastMarkup = renderToStaticMarkup(ui);
};
const screen = {
  getByTestId: (id: string) => {
    const hasId = lastMarkup.includes(`data-testid="${id}"`) || lastMarkup.includes(`data-testid='${id}'`);
    if (!hasId) throw new Error(`Could not find element with data-testid: ${id}`);
    return true;
  },
  queryByText: (matcher: RegExp | string) => {
    if (typeof matcher === 'string') {
      return lastMarkup.includes(matcher) ? true : null;
    }
    return matcher.test(lastMarkup) ? true : null;
  },
  getByText: (matcher: RegExp | string) => {
    const matched = typeof matcher === 'string' ? lastMarkup.includes(matcher) : matcher.test(lastMarkup);
    if (!matched) throw new Error(`Could not find text: ${matcher}`);
    return true;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TestChild = () => <div data-testid="child-content">Pool Content</div>;

function createPool(billing?: PoolBilling) {
  return { id: 'test-pool', name: 'Test Pool', billing };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Free / Active — Children rendered, no banner
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingGate — free / active state', () => {
  it('should render children without any banner when billing status is "free"', () => {
    const pool = createPool({
      status: 'free',
      tier: 'free_tier',
      pricePaid: 0,
      maxPlayersAllowed: 10,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={false}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.queryByText(/trial/i)).toBeNull();
    expect(screen.queryByText(/payment required/i)).toBeNull();
    expect(screen.queryByText(/pool locked/i)).toBeNull();
  });

  it('should render children without any banner when billing status is "active"', () => {
    const pool = createPool({
      status: 'active',
      tier: 'standard_tier',
      pricePaid: 29,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: true,
        smsNotifications: true,
        whatIfSimulator: true,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.queryByText(/upgrade/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. Active — commissioner-only "hosting fees paid" banner
//
// `active` was the one status with no banner at all. The rule is deliberately
// narrower than "status === 'active'": a pool activated on the free allocation
// is `active` with `tier: 'free_tier'` and paid NOTHING, so claiming its
// hosting fees are paid would be a fabricated claim on a money surface.
// ─────────────────────────────────────────────────────────────────────────────

const activeBilling = (over: Partial<PoolBilling> = {}): PoolBilling => ({
  status: 'active',
  tier: 'standard_tier',
  pricePaid: 29,
  maxPlayersAllowed: 25,
  featuresUnlocked: {
    aiCommissioner: false,
    smsNotifications: false,
    whatIfSimulator: false,
    customBranding: true,
  },
  ...over,
});

describe('BillingGate — active state, hosting-fees-paid banner', () => {
  it('shows the commissioner a paid banner naming the amount', () => {
    render(
      <BillingGate pool={createPool(activeBilling())} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.getByText(/hosting fees paid/i)).toBeTruthy();
    expect(screen.getByText('$29.00 paid')).toBeTruthy();
    expect(screen.getByTestId('icon-paid')).toBeTruthy();
  });

  it('is green with white text, per the request', () => {
    render(
      <BillingGate pool={createPool(activeBilling())} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    // Guards the two things that were actually specified. Without this a theme
    // refactor could silently turn the banner into the same slate gradient as
    // every other banner on the card.
    expect(screen.getByText(/linear-gradient\(135deg, ?#15803d/)).toBeTruthy();
    expect(screen.getByText(/color:#ffffff/)).toBeTruthy();
  });

  it('does NOT show it to a participant', () => {
    render(
      <BillingGate pool={createPool(activeBilling())} isCommissioner={false}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.queryByText(/hosting fees paid/i)).toBeNull();
  });

  it('does NOT claim fees were paid on a FREE-ALLOCATION pool', () => {
    // active + free_tier + pricePaid 0 — the pool that is activated and owes
    // nothing because it was never charged. Claiming "fees paid" here is the
    // fabricated-claim failure this condition exists to avoid.
    render(
      <BillingGate
        pool={createPool(activeBilling({ tier: 'free_tier', pricePaid: 0, maxPlayersAllowed: 10 }))}
        isCommissioner={true}
      >
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.queryByText(/hosting fees paid/i)).toBeNull();
  });

  it('DOES show it on a credit/promo activation, without inventing an amount', () => {
    // A pool credit or a 100%-off coupon leaves pricePaid at 0 but keeps the
    // quoted paid tier. The commissioner owes nothing and genuinely settled —
    // so the banner shows, and the copy must not print "$0.00 paid".
    render(
      <BillingGate
        pool={createPool(activeBilling({ tier: 'premium_tier', pricePaid: 0 }))}
        isCommissioner={true}
      >
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByText(/hosting fees paid/i)).toBeTruthy();
    expect(screen.getByText(/pool credit or promotion/i)).toBeTruthy();
    expect(screen.queryByText('$0.00 paid')).toBeNull();
  });

  it('never offers an upgrade CTA on an active pool', () => {
    render(
      <BillingGate pool={createPool(activeBilling())} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.queryByText(/upgrade/i)).toBeNull();
    expect(screen.queryByText('/pricing')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Trial — Children + trial banner visible
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingGate — trial state', () => {
  it('should render children AND a trial banner with days remaining', () => {
    const pool = createPool({
      status: 'trial',
      tier: 'free_tier',
      pricePaid: 0,
      trialEndsAt: Date.now() + 5 * 86_400_000, // 5 days from now
      maxPlayersAllowed: 10,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    // Children should still be rendered
    expect(screen.getByTestId('child-content')).toBeTruthy();
    // Trial banner text
    expect(screen.getByText(/trial ends in/i)).toBeTruthy();
  });

  it('should show "Upgrade Now" button for commissioner during trial', () => {
    const pool = createPool({
      status: 'trial',
      tier: 'free_tier',
      pricePaid: 0,
      trialEndsAt: Date.now() + 3 * 86_400_000,
      maxPlayersAllowed: 10,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByText(/upgrade now/i)).toBeTruthy();
  });

  it('should NOT show "Upgrade Now" button for non-commissioner during trial', () => {
    const pool = createPool({
      status: 'trial',
      tier: 'free_tier',
      pricePaid: 0,
      trialEndsAt: Date.now() + 3 * 86_400_000,
      maxPlayersAllowed: 10,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={false}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.queryByText(/upgrade now/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Grace period — Children + amber warning banner visible
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingGate — grace_period state', () => {
  it('should render children AND an amber warning banner', () => {
    const pool = createPool({
      status: 'grace_period',
      tier: 'standard_tier',
      pricePaid: 0,
      gracePeriodEndsAt: Date.now() + 3 * 86_400_000,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.getByText(/payment required/i)).toBeTruthy();
  });

  it('should show commissioner-specific message in grace period', () => {
    const pool = createPool({
      status: 'grace_period',
      tier: 'standard_tier',
      pricePaid: 0,
      gracePeriodEndsAt: Date.now() + 5 * 86_400_000,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByText(/complete payment to avoid losing access/i)).toBeTruthy();
  });

  it('should show player-specific message in grace period', () => {
    const pool = createPool({
      status: 'grace_period',
      tier: 'standard_tier',
      pricePaid: 0,
      gracePeriodEndsAt: Date.now() + 5 * 86_400_000,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={false}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByText(/pool commissioner needs to complete payment/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Locked — Blur overlay + modal visible, children blurred
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingGate — locked state', () => {
  it('should render children with blur and show a lockout overlay', () => {
    const pool = createPool({
      status: 'locked',
      tier: 'standard_tier',
      pricePaid: 0,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    // Children are rendered but inside a blurred container
    expect(screen.getByTestId('child-content')).toBeTruthy();
    // "Pool Locked" heading should be visible
    expect(screen.getByText(/pool locked/i)).toBeTruthy();
  });

  it('should show "Pay Now" button for commissioner when locked', () => {
    const pool = createPool({
      status: 'locked',
      tier: 'standard_tier',
      pricePaid: 0,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByText(/pay now/i)).toBeTruthy();
  });

  // ── 5. Commissioner vs player — Different messages in locked state ─────

  it('should show commissioner message when locked and isCommissioner=true', () => {
    const pool = createPool({
      status: 'locked',
      tier: 'standard_tier',
      pricePaid: 0,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByText(/your pool has been locked.*complete payment/i)).toBeTruthy();
  });

  it('should show player message when locked and isCommissioner=false', () => {
    const pool = createPool({
      status: 'locked',
      tier: 'standard_tier',
      pricePaid: 0,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={false}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByText(/paused while the commissioner completes payment/i)).toBeTruthy();
    expect(screen.getByText(/please contact your pool commissioner/i)).toBeTruthy();
  });

  it('should NOT show "Pay Now" button for player when locked', () => {
    const pool = createPool({
      status: 'locked',
      tier: 'standard_tier',
      pricePaid: 0,
      maxPlayersAllowed: 25,
      featuresUnlocked: {
        aiCommissioner: false,
        smsNotifications: false,
        whatIfSimulator: false,
        customBranding: true,
      },
    });

    render(
      <BillingGate pool={pool} isCommissioner={false}>
        <TestChild />
      </BillingGate>
    );

    // "Pay Now" only shows for commissioner
    expect(screen.queryByText(/^pay now$/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Undefined billing — Treated as free, no restrictions
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingGate — undefined billing', () => {
  it('should render children with no banners when billing is undefined', () => {
    const pool = createPool(undefined);

    render(
      <BillingGate pool={pool} isCommissioner={false}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.queryByText(/trial/i)).toBeNull();
    expect(screen.queryByText(/payment required/i)).toBeNull();
    expect(screen.queryByText(/pool locked/i)).toBeNull();
  });

  it('should render children with no banners when billing is undefined (commissioner)', () => {
    const pool = createPool(undefined);

    render(
      <BillingGate pool={pool} isCommissioner={true}>
        <TestChild />
      </BillingGate>
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.queryByText(/upgrade/i)).toBeNull();
    expect(screen.queryByText(/pay now/i)).toBeNull();
  });
});
