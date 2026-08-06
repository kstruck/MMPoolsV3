import type { User } from '../../../types';

/**
 * The create-pool wizard remembers who you are.
 *
 * Anyone creating a pool is already a signed-in member, so asking them to retype
 * their name, contact email and five payment handles every time is pure friction
 * — and every retype is a chance to get one wrong, on the fields members use to
 * actually pay them.
 *
 * Two halves, deliberately separate:
 *
 *  - `prefillFromUser` — what the wizard starts with, read from the profile.
 *  - `profileUpdatesFrom` — what to write BACK afterwards, so the next pool is
 *    already filled in.
 *
 * ## The write-back only fills BLANKS
 *
 * It never overwrites a value the profile already holds. Kevin's ask was "if not
 * known, add it to their profile" — and last-write-wins would be worse than
 * useless here: a commissioner who deliberately used a different Venmo for one
 * pool would silently have their default rewritten, and every later pool would
 * inherit the one-off. Filling blanks is monotonic and cannot lose information.
 *
 * ## `email` is deliberately never written back
 *
 * `users/{uid}.email` mirrors the Firebase Auth identity. The wizard's
 * `contactEmail` is a per-pool "how members reach you" field and is allowed to
 * differ. Writing one into the other would desync the account's email from the
 * one it authenticates with. Prefilling FROM it is safe and is what happens.
 */

/** The five handles the pool wizard collects, in its own shape. */
export type WizardHandles = {
  venmo: string;
  zelle: string;
  cashapp: string;
  paypal: string;
  googlePay: string;
};

const EMPTY_HANDLES: WizardHandles = { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' };

/** Handle keys, named once so the prefill and the write-back cannot drift apart. */
export const HANDLE_KEYS = ['venmo', 'zelle', 'cashapp', 'paypal', 'googlePay'] as const;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Identity + handle defaults for a wizard's `defaultValues`.
 *
 * Returns a fully-populated shape (empty strings, never `undefined`) because
 * react-hook-form treats a field that starts `undefined` and later receives a
 * string as going uncontrolled → controlled, which React warns about.
 */
export function prefillFromUser(user: User | null | undefined): {
  managerName: string;
  contactEmail: string;
  paymentHandles: WizardHandles;
} {
  const stored = user?.paymentHandles ?? {};
  const paymentHandles = { ...EMPTY_HANDLES };
  for (const k of HANDLE_KEYS) paymentHandles[k] = clean((stored as Record<string, unknown>)[k]);
  return {
    managerName: clean(user?.name),
    contactEmail: clean(user?.email),
    paymentHandles,
  };
}

/**
 * What to save back to the profile after a pool is created, or `null` if there
 * is nothing new to learn.
 *
 * Returning `null` rather than an empty object matters: the caller uses it to
 * skip the Firestore write entirely, so the common case (a commissioner whose
 * profile is already complete) costs nothing.
 */
export function profileUpdatesFrom(
  user: User | null | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!user) return null;
  const updates: Record<string, unknown> = {};

  // Name: only when the profile has none. `managerName` is what they just typed.
  if (!clean(user.name)) {
    const typed = clean(values.managerName);
    if (typed) updates.name = typed;
  }

  const typedHandles = (values.paymentHandles ?? {}) as Record<string, unknown>;
  const stored = (user.paymentHandles ?? {}) as Record<string, unknown>;
  for (const k of HANDLE_KEYS) {
    // Blanks only. An existing value always wins — see the docblock.
    if (clean(stored[k])) continue;
    const typed = clean(typedHandles[k]);
    // DOT PATHS, not a rebuilt `paymentHandles` object. Firestore's updateDoc
    // REPLACES a nested map wholesale, so writing the whole map would drop any
    // handle added since this component read `user` — e.g. the commissioner
    // editing their profile in another tab mid-wizard. A dot path merges, so
    // only the keys actually learned here are touched and a stale snapshot
    // cannot destroy a concurrent edit. (codex, on this PR.)
    if (typed) updates[`paymentHandles.${k}`] = typed;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}
