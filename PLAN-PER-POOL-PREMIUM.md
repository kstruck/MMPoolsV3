# PLAN — per-pool premium features

**Gate:** `mmp-change-control` §1 fires on **money** and **authorization**. Both
tickets below grant paid features, one of them takes payment, and one of them
adds a SUPER_ADMIN capability. Plan-gated.

**Author:** overnight session 2026-08-23 → 24. **Requested by Kevin, 2026-08-23:**

> "As the super-admin, I should be able to Turn On any feature for an individual
> pool and a pool manager must be able to buy a premium feature anytime during
> the season. For example, a pool manager decides he wants the AI premium
> feature. He needs a path to purchase this feature and then have that feature
> automatically turned on without my intervention. I, as the super-admin must be
> able to turn the feature on for any pool at any time through a toggle switch or
> something."

Two deliverables, two PRs.

---

## 0. Measured state (verified, not assumed)

| fact | where |
|---|---|
| `adminUpdatePoolBilling({action:'override'})` is SUPER_ADMIN-only and merges an **arbitrary** billing object onto one pool — so the server can already set `featuresUnlocked`. | `functions/src/adminBillingOps.ts:99` |
| There is **no UI** for it, and its audit row (`POOL_BILLING_OVERRIDE`) records only that *something* changed. | `src/components/SuperAdmin.tsx` Pools tab |
| `shared/editability.ts` does **not** expose `featuresUnlocked`, so no commissioner path can write it. | `shared/editability.ts` `KEY_GROUPS` |
| `/pricing` excludes `active` pools from the upgradeable list. | `src/components/billing/upgradeablePools.ts:16` |
| `assertPaidCeilingForUpdate` throws *"Enabling a paid add-on beyond the paid ceiling requires an upgrade payment."* | `functions/src/poolOps.ts:302-312` |
| The webhook stamps `billing.featuresUnlocked` and `billing.paid.addons` by **REPLACEMENT**, not merge. | `functions/src/stripe.ts:825-840` |
| 🛑 **`finalizePoolPayment` treats any session arriving for an `active` pool as a DOUBLE CHARGE**: the whole finalization no-ops and a `DOUBLE_CHARGE_REVIEW` alert is written. | `functions/src/stripe.ts:750-757` |

The last row is the real blocker for C2 and was not in the brief. A second
checkout against an already-active pool does not merely mis-stamp entitlements —
**it grants nothing at all** and files the payment as suspected double billing.
Any mid-season add-on purchase therefore needs its own purchase KIND, not just a
relaxed filter.

The `featuresUnlocked` **replacement** is real too, and confirmed: buying AI in
week 6 on a pool that bought What-If in week 1 would revoke What-If.

---

## C1 — SUPER_ADMIN per-pool feature toggle ✅ THIS PR

**New callable `adminSetPoolFeature({ poolId, feature, enabled })`,** SUPER_ADMIN,
`validated()`, correlated, audited.

Why a new callable rather than a UI over `adminUpdatePoolBilling`:

- **The input is a closed list.** `feature` is `z.enum(ADDON_KEYS)`; `enabled` is a
  boolean. There is no shape in which this call rewrites `status`, `tier`,
  `pricePaid`, `maxPlayersAllowed` or `paid.tier`.
- **The audit row says what happened.** `POOL_FEATURE_GRANT` /
  `POOL_FEATURE_REVOKE`, with `{ feature, enabled, previous }`. A money-adjacent
  grant that cannot be reconstructed from `admin_audit` is not auditable.

It writes **both** `billing.featuresUnlocked.<key>` (the entitlement every gate
reads) **and** `billing.paid.addons` (the ceiling `assertPaidCeilingForUpdate`
compares against, and the array a later purchase merges into) — but the second
**only when `billing.paid` already exists**, because writing it on a free or
trial pool would invent a purchase record and switch the ceiling gate on for a
pool that has none. Transactional, because `paid.addons` is read-modify-write.

It does **not** touch `billing.status`, `tier`, `pricePaid` or the ledger. A
grant is not a sale; nothing may claim money moved.

UI: a **Features** button on each row of the Super-Admin **All Pools** tab
expands one switch per add-on key, with explain-then-confirm before the write —
the AI copy names the Gemini spend (PLAN-COST-CONTROLS).

The list is `ADDON_KEYS`, not the sellable subset: an admin grant is not a sale
and Kevin asked for *any* feature. Keys nothing sells today (`smsNotifications`
clamped unsellable, `customBranding` free) are labelled as such rather than
hidden.

`shared/editability.ts` still does not expose `featuresUnlocked`, and this plan
does not change that.

---

## C2 — commissioner self-serve mid-season add-on purchase 🔜 NEXT PR

**Shape:** an ADD-ON-ONLY checkout for an ACTIVE pool, reusing
`createCheckoutSession`. `computeQuote` stays the sole price authority
(ADR-0001); the client never computes price.

1. **A purchase kind.** `checkoutPoolInputSchema` gains `purchaseKind:
   'pool' | 'addon'` (default `'pool'`, so every existing client is unchanged).
   `'addon'` requires the pool to be `active` and the caller to own it.
2. **Add-on-only pricing.** A quote with `basePrice` excluded and only the
   *newly requested* add-ons priced — a commissioner must not re-pay for an
   add-on they already hold. The already-owned set comes from
   `billing.paid.addons`, server-side.
3. **The double-charge guard has to learn the difference.** Today
   `billing.status === 'active'` is sufficient evidence of a double charge. It
   stops being sufficient: the guard must fire on a *pool* purchase for an
   active pool (still a double charge) and NOT on an *addon* purchase (the only
   time it is legitimate). Idempotency still rests on the ledger doc id =
   session id.
4. **Merge, never replace.** On success, `featuresUnlocked` and
   `paid.addons` MERGE with what the pool already holds. This is a bug fix
   independent of the feature: today a second successful purchase of any kind
   revokes previously-owned add-ons.
5. **A surface.** `upgradeablePools` keeps excluding `active` from the *hosting*
   upgrade list (that pool has no hosting to sell) and gains a separate add-on
   path reachable from the commissioner's own pool, where the feature is missed.

**Cost:** unlocking `aiCommissioner` means real Gemini spend. PLAN-COST-CONTROLS
governs it and is unchanged by this — the per-pool controls already apply once
the flag is on.

---

## Rollout

- C1: `functions/` change → `npx firebase deploy --only functions` (CLAUDE.md §3,
  step zero first). No `firestore.rules` change. Coolify `www` rebuild for the UI.
- C2: same, plus a Stripe webhook path — deploy functions **before** shipping the
  frontend that can start such a checkout, or a paid session finalizes against
  the old handler and is filed as a double charge.

## Gates

Per PR: root vitest, `npm --prefix functions test`, `npx tsc -b`, functions
typecheck, lint delta zero measured by `eslint . -f json` diff, and
`codex exec review --base origin/main` per §2c (qodo DORMANT — two-condition
stopping rule). Every behaviour change ships with its test in the same PR.
