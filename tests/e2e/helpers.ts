import type { Page } from '@playwright/test';

// Full-stack E2E helpers driving the REAL app (registration form, wizard UI,
// createPool/createNFLPool/createBracketPool callables) against local Firebase
// emulators — no mocks, no auth bypass. Each test should call registerFreshUser
// with a unique email so re-runs against a reused (not-restarted) emulator
// don't collide with "email already in use".

export async function registerFreshUser(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Get Started/i }).click();
  // Ensure Register mode (the modal may default to either mode).
  const nameField = page.locator('input[type="text"]').first();
  if (!(await nameField.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Don't have an account\? Register/i }).click();
  }
  await page.locator('input[type="text"]').first().fill(`E2E ${email}`);
  await page.locator('input[type="email"]').fill(email);
  // Auth emulator enforces a password policy (upper case + non-alphanumeric
  // required) — a plain lowercase/digits password fails registration silently
  // client-side (a toast/console error, no thrown navigation error), which
  // otherwise manifests downstream as every subsequent step timing out.
  await page.locator('input[type="password"]').fill('TestPass123!');
  await page.getByRole('button', { name: /Create Account/i }).click();
  // Registration redirects to /participant on success.
  await page.waitForURL(/\/participant/, { timeout: 15_000 });
}

/**
 * Promotes a just-registered user to SUPER_ADMIN directly against the local
 * Firestore emulator (admin bypass token — never touches real Firebase).
 *
 * Needed because `canAccessPoolCreation` = `POOLS_OPEN || isSuperAdmin(user)`,
 * and POOLS_OPEN is currently false (pre-season gate) — a normal test user
 * would get redirected away from every /create/:type route. Per the code's
 * own comment, super admins are meant to reach creation flows for internal
 * testing while the season gate is closed; this exercises exactly that path.
 * The app reads `user.role` from a live Firestore listener, so the client
 * gate updates without a reload once this PATCH lands.
 */
async function findUserDocByEmail(email: string): Promise<string | null> {
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'email' },
          op: 'EQUAL',
          value: { stringValue: email },
        },
      },
    },
  };
  const queryRes = await fetch(
    'http://127.0.0.1:8080/v1/projects/demo-mmp/databases/(default)/documents:runQuery',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    },
  );
  const [result] = (await queryRes.json()) as Array<{ document?: { name: string } }>;
  return result?.document ? result.document.name.split('/').pop()! : null;
}

async function readUserRole(uid: string): Promise<string | undefined> {
  const res = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-mmp/databases/(default)/documents/users/${uid}`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  if (!res.ok) return undefined;
  const doc = (await res.json()) as { fields?: { role?: { stringValue?: string } } };
  return doc.fields?.role?.stringValue;
}

export async function promoteToSuperAdmin(email: string): Promise<void> {
  // Find the user doc by email (written by the real onUserCreated trigger).
  // Retry: the trigger can lag the registration response by a beat, especially
  // for the very first request against a freshly-booted emulator.
  let uid: string | null = null;
  for (let i = 0; i < 10 && !uid; i++) {
    uid = await findUserDocByEmail(email);
    if (!uid) await new Promise((r) => setTimeout(r, 500));
  }
  if (!uid) throw new Error(`promoteToSuperAdmin: no users/{uid} doc found for ${email}`);

  const patch = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-mmp/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=role`,
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { role: { stringValue: 'SUPER_ADMIN' } } }),
    },
  );
  if (!patch.ok) throw new Error(`promoteToSuperAdmin: Firestore PATCH failed ${patch.status}`);

  // Read back to confirm the write actually persisted before returning —
  // don't just trust a 200 from the PATCH.
  for (let i = 0; i < 10; i++) {
    if ((await readUserRole(uid)) === 'SUPER_ADMIN') return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`promoteToSuperAdmin: role never read back as SUPER_ADMIN for uid ${uid}`);
}

/** Clicks Next repeatedly from wherever the wizard currently is until Review, then accepts TOS. */
export async function advanceToReview(page: Page): Promise<void> {
  const tosLabel = page.locator('label', { hasText: /Terms of Service/i });
  for (let i = 0; i < 8; i++) {
    if (await tosLabel.isVisible().catch(() => false)) break;
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
  }
  // The Launch step disables its submit until the player estimate is set
  // (LaunchStep.tsx `estimateSet`; every wizard defaults estimatedPlayers: 0).
  // Diagnosed 2026-08-24: all 7 create-pool tests timed out on a [disabled]
  // "Launch free pool" button with the estimate spinner still at 0.
  const estimate = page.getByRole('spinbutton', { name: /Expected number of players/i });
  if (await estimate.isVisible().catch(() => false)) {
    await estimate.fill('10');
  }
  await tosLabel.locator('input[type="checkbox"]').check();
}

/** Fills #name (must be on the Basics step), then advances to Review and accepts TOS. */
export async function fillBasicsAndAdvanceToReview(page: Page, poolName: string): Promise<void> {
  const name = page.locator('#name');
  await name.waitFor({ state: 'visible', timeout: 15_000 });
  await name.fill(poolName);
  await advanceToReview(page);
}

/** Clicks the final submit button and waits for navigation to /pool/:id. */
export async function submitAndExpectPoolCreated(page: Page, submitLabelPattern: RegExp): Promise<string> {
  await page.getByRole('button', { name: submitLabelPattern }).click();
  await page.waitForURL(/\/pool\/[a-zA-Z0-9]+/, { timeout: 15_000 });
  const match = page.url().match(/\/pool\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error(`Did not navigate to a pool URL; landed on ${page.url()}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// Reading what the app actually wrote. A test that only looks at the page can
// be satisfied by a page that shows the right thing over the wrong document.
// ---------------------------------------------------------------------------

type FsValue = Record<string, unknown>;

/** Firestore's REST wire format -> a plain value. */
function decode(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (((v.arrayValue as { values?: FsValue[] }).values) ?? []).map(decode);
  if ('mapValue' in v) return decodeFields(((v.mapValue as { fields?: Record<string, FsValue> }).fields) ?? {});
  return undefined;
}

function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));
}

const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-mmp/databases/(default)/documents';

/** One document from the emulator, read with the admin bypass token. Null if it does not exist. */
export async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`readDoc ${path}: ${res.status}`);
  const doc = (await res.json()) as { fields?: Record<string, FsValue> };
  return decodeFields(doc.fields ?? {});
}

/** Merge fields into a document on the emulator (admin bypass) — for config a test needs set. */
export async function patchDoc(path: string, fields: Record<string, FsValue>, mask: string[]): Promise<void> {
  const qs = mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
  const res = await fetch(`${FIRESTORE}/${path}?${qs}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`patchDoc ${path}: ${res.status}`);
}

/** Polls until `read` returns something `ok` accepts; returns it. For writes that land a beat after a click. */
export async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await read();
  while (!ok(last)) {
    if (Date.now() > deadline) throw new Error(`eventually: ${what} — last value ${JSON.stringify(last)?.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 300));
    last = await read();
  }
  return last;
}

