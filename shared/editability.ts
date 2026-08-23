// Per-type editability matrix for pool settings edits (updatePoolSettings + the
// Phase B shell edit mode). Grounded in what the live dashboards actually let a
// commissioner change (PlayoffSettingsModal: name/lock; NFLManagerView:
// name/contact/full settings; PropsManager: props.questions) — not guessed.
//
// The gate is by lifecycle phase, not a single OPEN rule (pool types use
// different status vocab; normalizePhase collapses them).

export type LifecyclePhase = 'draft' | 'open' | 'locked' | 'archived';

export type EditableGroup =
  | 'basics' // name
  | 'contact' // managerName, contact*
  | 'paymentHandles' // handles + paymentInstructions
  | 'payouts'
  | 'branding'
  | 'reminders'
  | 'entryFee'
  | 'settings' // type-specific settings blob (scoring, rules, ...)
  | 'props' // props-pool questions/cost
  | 'announcement' // pinnedMessageId — which feed post sits at the top of pool home
  | 'lifecycle'; // isLocked / status / visibility

const ALL_GROUPS: readonly EditableGroup[] = [
  'basics', 'contact', 'paymentHandles', 'payouts', 'branding',
  'reminders', 'entryFee', 'settings', 'props', 'announcement', 'lifecycle',
];

// draft/open: fully editable (matches today's dashboards, which let commissioners
// change settings/payouts while the pool is open). locked: only safe cosmetic +
// contact + lock toggle — structural money fields are frozen once players have
// committed. archived: essentially read-only save for branding + un-archive.
const MATRIX: Record<LifecyclePhase, ReadonlySet<EditableGroup>> = {
  draft: new Set(ALL_GROUPS),
  open: new Set(ALL_GROUPS),
  // `announcement` is editable in EVERY phase, and that is the whole point of
  // the group existing. Pinning a message is an IN-SEASON act — "week 6 dues are
  // late", "no games Thursday" — so gating it behind draft/open would make the
  // feature unusable exactly when it is wanted. It carries no money, no
  // authorization and no scoring input: the value is the id of a post that is
  // already visible to every member of the pool, and the commissioner who can
  // pin it could already post and delete it.
  locked: new Set<EditableGroup>(['basics', 'contact', 'paymentHandles', 'branding', 'reminders', 'announcement', 'lifecycle']),
  archived: new Set<EditableGroup>(['branding', 'announcement', 'lifecycle']),
};

export function normalizePhase(pool: { isLocked?: boolean; status?: string } | null | undefined): LifecyclePhase {
  if (pool?.isLocked) return 'locked';
  const s = String(pool?.status ?? '').toUpperCase();
  if (s === 'DRAFT') return 'draft';
  if (s === 'ARCHIVED' || s === 'COMPLETED') return 'archived';
  return 'open'; // OPEN, active, or unset
}

export function isGroupEditable(phase: LifecyclePhase, group: EditableGroup): boolean {
  return MATRIX[phase].has(group);
}

// Maps a top-level update payload key to its editable group. Keys not listed
// here are unknown and rejected by the update gate.
const KEY_GROUPS: Readonly<Record<string, EditableGroup>> = {
  name: 'basics',
  managerName: 'contact',
  contactEmail: 'contact',
  contactPhone: 'contact',
  contactMethod: 'contact',
  paymentInstructions: 'paymentHandles',
  paymentHandles: 'paymentHandles',
  venmo: 'paymentHandles',
  zelle: 'paymentHandles',
  cashapp: 'paymentHandles',
  paypal: 'paymentHandles',
  googlePay: 'paymentHandles',
  payouts: 'payouts',
  branding: 'branding',
  reminders: 'reminders',
  entryFee: 'entryFee',
  settings: 'settings',
  props: 'props',
  pinnedMessageId: 'announcement',
  isLocked: 'lifecycle',
  status: 'lifecycle',
  isListedPublic: 'lifecycle',
  isPublic: 'lifecycle',
};

export function classifyUpdateKey(key: string): EditableGroup | undefined {
  return KEY_GROUPS[key];
}
