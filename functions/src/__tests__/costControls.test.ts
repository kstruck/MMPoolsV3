import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * PLAN-COST-CONTROLS Phase 0.5.3/0.4 — the cost-control kill-switch.
 *
 * The POLARITY is what these tests exist to pin. `lib/systemGuards.ts` reads the
 * same `system/config` doc and fails OPEN on purpose; this module fails CLOSED,
 * because for an OPTIONAL PAID feature "inaction" is the safe state and a
 * Firestore outage must never be able to turn spend ON. Someone consolidating
 * the two readers "because they do the same thing" is the exact regression here.
 *
 * The audience split is the second half: Kevin's D4 turns MEMBER SMS off while
 * keeping his own security alerts working, and both flow through the same
 * sendCourierSMS — so a switch that cannot tell them apart cannot satisfy D4.
 */

/** The shape lib/costControls reads back — `unknown` payloads on purpose, so
 *  the truthy-but-not-true case below can pass a non-boolean. */
type ConfigDoc = { exists: boolean; data: () => Record<string, unknown> | undefined };

const h = vi.hoisted(() => ({
  // What system/config.get() resolves to. Each test sets this.
  configDoc: { exists: true, data: () => ({}) } as ConfigDoc,
  shouldThrow: false,
  reads: 0,
}));

vi.mock('firebase-admin', () => {
  const firestore = () => ({
    collection: () => ({
      doc: () => ({
        get: async () => {
          h.reads++;
          if (h.shouldThrow) throw new Error('Firestore unavailable');
          return h.configDoc;
        },
      }),
    }),
  });
  return { default: { firestore }, firestore };
});

const { isMemberSmsEnabled, __resetCostControlsCache } = await import('../lib/costControls');

const setConfig = (costControls: Record<string, unknown> | undefined) => {
  h.shouldThrow = false;
  h.configDoc = { exists: true, data: () => ({ costControls }) };
  // Every test below wants its OWN config observed, so the cache is dropped
  // here rather than in each case.
  __resetCostControlsCache();
};

beforeEach(() => {
  h.shouldThrow = false;
  h.configDoc = { exists: true, data: () => ({}) };
  h.reads = 0;
  __resetCostControlsCache();
});

describe('isMemberSmsEnabled — deny by default, in every failure shape', () => {
  it('is ENABLED only on an explicit true', async () => {
    setConfig({ sms: { enabled: true } });
    expect(await isMemberSmsEnabled()).toBe(true);
  });

  it('denies on an explicit false', async () => {
    setConfig({ sms: { enabled: false } });
    expect(await isMemberSmsEnabled()).toBe(false);
  });

  it('denies when the sms block is missing', async () => {
    setConfig({ ai: { enabled: true } });
    expect(await isMemberSmsEnabled()).toBe(false);
  });

  it('denies when costControls is missing entirely — TODAY\'s production state', async () => {
    // Nothing has written system/config.costControls yet, so this is the value
    // the switch actually returns in prod the moment 0.5.3 deploys: SMS off,
    // which is where Kevin wants it (decision #3). If this ever returns true,
    // member SMS silently turns back on at deploy time.
    setConfig(undefined);
    expect(await isMemberSmsEnabled()).toBe(false);
  });

  it('denies when the whole config doc is absent', async () => {
    h.configDoc = { exists: false, data: () => undefined };
    __resetCostControlsCache();
    expect(await isMemberSmsEnabled()).toBe(false);
  });

  it('denies when the config READ THROWS — fail-closed, the opposite of systemGuards', async () => {
    // systemGuards.loadConfig() returns null and callers proceed ("a config-read
    // failure must never block legitimate actions"). Here the same failure must
    // deny: an outage must not be able to enable spend.
    h.shouldThrow = true;
    __resetCostControlsCache();
    expect(await isMemberSmsEnabled()).toBe(false);
  });

  it('denies on a truthy-but-not-true value (no coercion)', async () => {
    setConfig({ sms: { enabled: 'yes' } });
    expect(await isMemberSmsEnabled()).toBe(false);
  });
});

describe('the switch is cached — a reminder blast is not N config reads', () => {
  // The reminder passes call sendCourierSMS once per RECIPIENT, and it consults
  // the switch on every send. Uncached, that was one system/config read per
  // member per run — spending Firestore reads to check a cost-control switch,
  // which is the shape of thing this plan exists to stop (codex round 5).

  it('reads the config once across many sends', async () => {
    setConfig({ sms: { enabled: true } });
    h.reads = 0;
    for (let i = 0; i < 25; i++) expect(await isMemberSmsEnabled()).toBe(true);
    expect(h.reads, 'the switch is being re-read per send').toBe(1);
  });

  it('collapses OVERLAPPING misses into a single read (single-flight)', async () => {
    // Without single-flight both callers fetch, and the last to finish installs
    // its value — which can put an OLDER config over a newer one and push real
    // staleness past the 60s this module advertises (codex round 6). It also
    // matters on a cold instance, where a burst of sends would otherwise
    // stampede the very read the cache exists to avoid.
    setConfig({ sms: { enabled: true } });
    h.reads = 0;
    const [a, b, c] = await Promise.all([
      isMemberSmsEnabled(), isMemberSmsEnabled(), isMemberSmsEnabled(),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(h.reads, 'concurrent misses each issued their own read').toBe(1);
  });

  it('recovers after a failed in-flight read — the next call retries', async () => {
    // The `finally` that clears `inflight` is load-bearing: leaving a rejected
    // promise parked there would make every later caller reuse the failure.
    h.shouldThrow = true;
    __resetCostControlsCache();
    expect(await isMemberSmsEnabled()).toBe(false);

    h.shouldThrow = false;
    h.configDoc = { exists: true, data: () => ({ costControls: { sms: { enabled: true } } }) };
    h.reads = 0;
    expect(await isMemberSmsEnabled(), 'a stale in-flight promise was reused').toBe(true);
    expect(h.reads, 'the retry did not actually re-read').toBe(1);
  });

  it('does NOT cache a failure — a blip must not pin fail-closed after it clears', async () => {
    // Caching the error would keep answering "disabled" for the whole TTL after
    // Firestore recovered, turning a momentary blip into a minute of silently
    // dropped member SMS.
    h.shouldThrow = true;
    __resetCostControlsCache();
    expect(await isMemberSmsEnabled()).toBe(false);

    h.shouldThrow = false;
    h.configDoc = { exists: true, data: () => ({ costControls: { sms: { enabled: true } } }) };
    expect(await isMemberSmsEnabled(), 'the failure was cached').toBe(true);
  });
});

describe('every sendCourierSMS call site declares an audience (source-level)', () => {
  // Source-level for the same reason deliveryTally.test.ts is: driving these
  // handlers to their send stage needs a full Firestore fake, and what matters
  // is the STATIC property — that no call site is ambiguous about whether it is
  // member traffic. `audience` is a required parameter, so tsc already refuses a
  // missing one; this pins the ASSIGNMENTS, which tsc cannot check. Getting one
  // wrong is silent in both directions: 'security' on a member blast bypasses
  // Kevin's kill-switch, 'member' on the security alert takes it down with it.
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  const callSites = (src: string) =>
    src.split(/\r?\n/)
      .filter((l) => /\bsendCourierSMS\(/.test(l))
      // Comment lines, in every prefix this repo actually uses. `/**` matters:
      // opsAlertDispatcher.ts:116 names sendCourierSMS inside a docblock that
      // opens on the same line, and without this the ops-pager case below would
      // depend on that sentence keeping a space before its parenthesis.
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .filter((l) => !/export async function sendCourierSMS/.test(l));

  it('reminders.ts sends are BOTH member traffic — the sends the switch must stop', () => {
    const sites = callSites(read('reminders.ts'));
    expect(sites.length).toBe(2);
    expect(sites.every((l) => /'member'\)/.test(l)), `not member:\n${sites.join('\n')}`).toBe(true);
  });

  it('userManagement.ts sends are NOT member traffic — D4 keeps them working', () => {
    const sites = callSites(read('userManagement.ts'));
    expect(sites.length).toBe(2);
    expect(sites.some((l) => /'security'\)/.test(l)), 'security alert lost its audience').toBe(true);
    expect(sites.some((l) => /'test'\)/.test(l)), 'testSmsHttp lost its audience').toBe(true);
    expect(sites.some((l) => /'member'\)/.test(l)), 'a D4-exempt send is now gated as member').toBe(false);
  });

  it('the ops pager does NOT route through sendCourierSMS at all', () => {
    // sendOpsSMS is its own api.courier.com call by design ("Distinct code path
    // — do not reuse the end-user SMS path"). If someone ever consolidates it
    // onto sendCourierSMS, it inherits the member kill-switch and Kevin stops
    // getting paged. That is the failure this asserts against.
    expect(callSites(read('lib/opsAlertDispatcher.ts'))).toEqual([]);
  });
});
