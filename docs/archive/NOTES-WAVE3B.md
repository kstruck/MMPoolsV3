# NOTES-WAVE3B — Canonical Entitlements (Bundles + Pool Credits)

Wave 3B implements the canonical entitlement model (PLAN Phase 4 #13-17): the
`bundles/{bundleId}` + `bundles/{bundleId}/credits/{creditId}` collections that
replace the four legacy user-doc fields (`freePoolsAvailable`, `activeBundleType`,
`bundleExpiresAt`, `poolCredits[]`).

This wave writes those collections via the Admin SDK only (rules-bypassing). It
does NOT touch `firestore.rules` (Wave 5 owns it) — the required rules are below.

---

## (a) firestore.rules the new collections need (Wave 5)

Two NEW collections. **All writes are functions-only** (Admin SDK); clients only
READ their own. Owner-read-own + SUPER_ADMIN read; no client writes at all.

```
// bundles/{bundleId} — canonical entitlement doc (owner-scoped)
match /bundles/{bundleId} {
  // Owner reads their own bundles (the "My Bundles & Credits" dashboard card);
  // SUPER_ADMIN reads any (admin panel). No client writes — grants/revokes go
  // through the adminGrantEntitlement / adminRevokeEntitlement callables, and
  // purchase grants through the Stripe webhook.
  allow read: if request.auth != null
    && (resource.data.ownerId == request.auth.uid || isSuperAdmin());
  allow write: if false;

  // credits/{creditId} — per-credit redeemable docs
  match /credits/{creditId} {
    // Inherit the parent bundle's owner. get() the parent to check ownership so
    // a credit is readable only by its bundle's owner (or SUPER_ADMIN).
    allow read: if request.auth != null
      && (
        get(/databases/$(database)/documents/bundles/$(bundleId)).data.ownerId == request.auth.uid
        || isSuperAdmin()
      );
    allow write: if false;
  }
}
```

Notes for the rules author:
- `isSuperAdmin()` — reuse the project's existing helper (claim-based:
  `request.auth.token.role == 'SUPER_ADMIN'`). Match the convention already used
  for `admin_audit` / `billingCharges` reads.
- The credit sub-collection read rule does a parent `get()`. If read volume makes
  that costly, an alternative is to denormalize `ownerId` onto each credit doc and
  match on `resource.data.ownerId` — but the current grant path does NOT write
  `ownerId` onto credits, so if you take that route, add it to
  `grantEntitlementTxn` (functions/src/entitlements.ts) at the same time.
- Writes are `false` for BOTH collections. The Admin SDK bypasses rules, so the
  webhook + callables keep working; this only blocks client tampering.

Until these rules land, client `bundles` reads return **permission-denied**. The
dashboard card (`MyBundlesCard` in `src/components/ManagerDashboard.tsx`) and the
`dbService.subscribeToMyBundles` reader already swallow that error and hide the
card, so nothing crashes in the meantime.

---

## (b) Human / ops actions

1. **Stripe: nothing new.** No new webhook event types and no new products are
   required for this wave. Bundle purchases already flow through the existing
   `checkout.session.completed` handler and `settings/billing_config.packagesList`
   / `settings/billing_config.packages` pricing. (Wave 2's new event types —
   `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` — are
   still the ones to enable per NOTES-WAVE2, unrelated to this wave.)

2. **Migration must be RUN during the Phase-4 cutover freeze.**
   `scripts/migrate-entitlements.mjs` backfills legacy fields into the canonical
   model. It is **DRY-RUN by default** and was **NOT executed** by this wave.
   Run it only inside the cutover freeze, in the change-control sequence:
   - stop new entitlement checkout sessions (flag) + drain/expire in-flight bundle
     sessions (no late webhook mid-backfill);
   - short entitlement-write freeze (grants + redemptions paused);
   - `node scripts/migrate-entitlements.mjs` (DRY RUN) → review the per-user census;
   - `node scripts/migrate-entitlements.mjs --commit` (WRITES) inside the freeze;
   - verify the census "old === new" parity line;
   - flip the legacy readers (see below), unfreeze;
   - delete the legacy user fields in a later cleanup once a billing cycle passes.
   Kill switch: set `MIGRATION_ABORT=1` in the env to stop between pages.
   The script requires `./serviceAccountKey.json` (same as the other admin scripts).

3. **Legacy readers still to flip (NOT owned by this wave).** These still read the
   old fields and should be pointed at the new model at cutover step (4):
   - `src/components/BillingInvoiceCard.tsx` (bundle/credit display, ~231-267)
   - the redemption reader in `stripe.ts` `createCheckoutSession` free-path
     (`usedCredit`/`customCreditId` still reads `users.poolCredits` /
     `users.freePoolsAvailable`, ~237-248) — this is the standard pool-payment
     path a PARALLEL wave owns; it should switch to `redeemPoolCredit`.
   The Super-Admin referral tab still shows `users.freePoolsAvailable` as a number;
   that display is legacy but harmless (the underlying grant now creates a bundle).

4. **New callables to allow in the client permission/App-Check config** (if the
   project gates callable names anywhere): `adminGrantEntitlement`,
   `adminRevokeEntitlement`, `redeemPoolCredit`.

5. **Firestore composite index** (add to `firestore.indexes.json` before
   redemption goes live). `redeemPoolCreditForPool` runs, when no specific bundle
   is targeted, a composite query on `bundles`:
   `ownerId ==` + `productKind ==` + `status ==`. Firestore needs a composite
   index for that three-field equality query:
   ```json
   {
     "collectionGroup": "bundles",
     "queryScope": "COLLECTION",
     "fields": [
       { "fieldPath": "ownerId", "order": "ASCENDING" },
       { "fieldPath": "productKind", "order": "ASCENDING" },
       { "fieldPath": "status", "order": "ASCENDING" }
     ]
   }
   ```
   (`subscribeToMyBundles` only filters on `ownerId ==`, which is served by the
   single-field index and needs no composite index.)

---

## (c) Unverified / carried-forward

- **Client `bundles` reads are UNVERIFIED end-to-end** — they depend on the Wave 5
  rules above. The query is built and guarded (`subscribeToMyBundles` +
  `MyBundlesCard`), and it will work once the rules land. It was not exercised
  against the emulator here (the default vitest gate is mock-only; the emulator
  rules test suite is separate).
- **The migration script was NOT executed** (dry-run default, `--commit` not run).
  Only its pure mapping (`mapLegacyUserToEntitlements`) is unit-tested.
- **Redemption pool-ownership field**: `redeemPoolCreditForPool` derives the pool
  owner as `createdByUid || ownerId || managerUid` (mirrors `poolOps.ts`). If any
  pool type persists the owner under a different key, redemption ownership checks
  would need that key added. Verified against `poolOps.ts` createPool; other create
  paths (nflPools/bracketPools/etc.) were not re-audited (owned by other waves).
- **`redeemPoolCredit` is exported and wired** but no client surface calls it yet
  (the wizard payment step that offers "Redeem entitlement" is a parallel wave).
  The callable + `dbService.redeemPoolCredit` wrapper are ready for it.
- **Idempotency of purchase grants** relies on a deterministic bundle id
  (`purchase_<stripeSessionId>`); a webhook retry re-reads that doc and no-ops.
  This was unit-tested for the grant/redeem/revoke transaction logic against an
  in-memory Firestore fake, not against live Stripe retries.

---

## Verification performed by this wave (from D:\mmp-buyflow-ent)

- `npm --prefix functions run build` → exit 0.
- `npm --prefix functions run test` → 14 files, 219 tests passing (was 200;
  +19 across `bundleSchema.test.ts` and `entitlements.test.ts`).
- `npx tsc --noEmit -p tsconfig.app.json` → 0 errors (the 7 pre-existing
  `SuperAdminBillingPanel.tsx` drift errors are GONE; `ManagerDashboard.tsx` and
  `dbService.ts` clean).
- `npx tsc -p shared` → exit 0.
- Migration script: **NOT executed** (by design).
