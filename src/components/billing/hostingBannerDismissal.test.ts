/**
 * Unit tests for the hosting-banner dismissal storage.
 *
 * These run in vitest's default `node` environment (no `environment` is set in
 * `vite.config.ts`), so there is no DOM and no `localStorage` unless a test
 * installs one. That is not an obstacle to test — it IS the first case worth
 * testing, because `BillingGate` calls `isHostingBannerDismissed` during render
 * and `src/__tests__/billingGate.test.tsx` renders it in exactly this
 * environment. A helper that assumed `localStorage` would take that whole suite
 * down with it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  hostingBannerDismissKey,
  isHostingBannerDismissed,
  dismissHostingBanner,
} from './hostingBannerDismissal';

/** Installs a `localStorage` on the global and returns its backing map. */
function installStorage(overrides: Partial<Storage> = {}): Map<string, string> {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
    ...overrides,
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
  return data;
}

afterEach(() => {
  // `delete` rather than assigning undefined: the helper branches on
  // `typeof localStorage === 'undefined'`, and an own property holding
  // `undefined` still satisfies that check but would leave a different shape
  // behind than the suite started with.
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('hostingBannerDismissKey', () => {
  it('namespaces by pool so one pool cannot dismiss another', () => {
    expect(hostingBannerDismissKey('abc123')).toBe('mmp:hostingBannerDismissed:abc123');
    expect(hostingBannerDismissKey('abc123')).not.toBe(hostingBannerDismissKey('abc124'));
  });
});

describe('isHostingBannerDismissed / dismissHostingBanner — no storage at all', () => {
  it('reports NOT dismissed rather than throwing', () => {
    // The state this file's header is about: the render path in a suite with
    // no DOM. Showing the banner is the safe answer on a money surface.
    expect(isHostingBannerDismissed('abc123')).toBe(false);
  });

  it('writing is a silent no-op rather than throwing', () => {
    expect(() => dismissHostingBanner('abc123')).not.toThrow();
  });
});

describe('isHostingBannerDismissed / dismissHostingBanner — with storage', () => {
  it('round-trips a dismissal for one pool', () => {
    installStorage();

    expect(isHostingBannerDismissed('abc123')).toBe(false);
    dismissHostingBanner('abc123');
    expect(isHostingBannerDismissed('abc123')).toBe(true);
  });

  it('does not leak the dismissal to a different pool', () => {
    installStorage();

    dismissHostingBanner('abc123');
    expect(isHostingBannerDismissed('abc124')).toBe(false);
  });

  it('writes under the documented key and nothing else', () => {
    const data = installStorage();

    dismissHostingBanner('abc123');
    expect(Array.from(data.keys())).toEqual(['mmp:hostingBannerDismissed:abc123']);
  });

  it('treats a value other than the written one as NOT dismissed', () => {
    const data = installStorage();

    // Guards against a lenient `!= null` read. Anything this module did not
    // write — a stale format, another tab's junk — must not hide the banner.
    data.set(hostingBannerDismissKey('abc123'), 'false');
    expect(isHostingBannerDismissed('abc123')).toBe(false);

    data.set(hostingBannerDismissKey('abc123'), '');
    expect(isHostingBannerDismissed('abc123')).toBe(false);
  });
});

describe('missing pool id', () => {
  it('never reports dismissed without an id, even with storage present', () => {
    installStorage();

    expect(isHostingBannerDismissed(undefined)).toBe(false);
    expect(isHostingBannerDismissed('')).toBe(false);
  });

  it('never writes without an id — an unkeyed dismissal would hide EVERY pool', () => {
    const data = installStorage();

    dismissHostingBanner(undefined);
    dismissHostingBanner('');
    expect(data.size).toBe(0);
  });
});

describe('storage present but throwing', () => {
  it('a throwing getItem reads as NOT dismissed', () => {
    installStorage({
      getItem: () => {
        throw new Error('SecurityError: access denied');
      },
    });

    expect(() => isHostingBannerDismissed('abc123')).not.toThrow();
    expect(isHostingBannerDismissed('abc123')).toBe(false);
  });

  it('a throwing setItem loses the persistence, not the click', () => {
    // Safari private mode with a zero quota is the real-world instance.
    installStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });

    expect(() => dismissHostingBanner('abc123')).not.toThrow();
  });
});
