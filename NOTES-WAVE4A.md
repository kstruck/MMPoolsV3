# NOTES-WAVE4A — Monetization tab: accounting, coupon-abuse alerts, coupon templates

Wave 4A implements PLAN-BUYFLOW-OVERHAUL Phase 6 items 21–23 (the Super-Admin
Monetization surface): a ledger-driven accounting view, a coupon-abuse alert
center + scheduled detection job, and Coupon Templates. All reads are
SUPER_ADMIN-only; all mutations go through audited callables.

This wave writes NEW collections via the Admin SDK (rules-bypassing) and adds
guarded client reads. It does NOT touch `firestore.rules` (that is Wave 5 /
item 24). The hand-off below is what Wave 5 must add and what a human must
configure before the alert job does anything.

---

## (a) firestore.rules Wave 5 must add (PLAN item 24)

Per ADR-0002 + PLAN #24, the new/tightened collections need these rules. Until
they land, the affected client reads return `permission-denied`; every
Monetization sub-panel wires `onError` and shows a "locked" message instead of
crashing (verified via the `locks` state in `MonetizationDashboard.tsx`).

Reuse the project's existing `isSuperAdmin()` helper (claim-based:
`request.auth.token.role == 'SUPER_ADMIN'`), matching the `admin_audit` /
`billingCharges` read convention.

```
// coupons/{couponId} — usageLog now carries per-user reservation activity, so
// per ADR-0002 the collection becomes SUPER_ADMIN client-read-only. Buyer-side
// validation already goes through getPoolQuote (sanitized), not a client read.
match /coupons/{couponId} {
  allow read: if isSuperAdmin();
  allow write: if false;            // create/delete/toggle via adminManageCoupon
}

// couponTemplates/{templateId} — SUPER_ADMIN DIRECT client read (powers the
// Monetization → Templates list). ALL writes functions-only (the
// createCouponTemplate / updateCouponTemplate / deleteCouponTemplate callables).
match /couponTemplates/{templateId} {
  allow read: if isSuperAdmin();
  allow write: if false;
}

// monetization_alerts/{alertId} — SUPER_ADMIN read; writes functions-only
// (this wave's monetizationAlerts job + the Wave-2 refund/dispute/double-charge
// writers + the acknowledgeMonetizationAlert callable). No client writes.
match /monetization_alerts/{alertId} {
  allow read: if isSuperAdmin();
  allow write: if false;
}
```

Also still outstanding from earlier waves (needed by the User-money-profile +
Bundle-liability panels, restated here so item 24 covers them in one place):

```
// bundles/{bundleId} — owner read own + SUPER_ADMIN read all; writes functions-only.
match /bundles/{bundleId} {
  allow read: if request.auth != null
    && (resource.data.ownerId == request.auth.uid || isSuperAdmin());
  allow write: if false;
  match /credits/{creditId} {
    allow read: if request.auth != null
      && (get(/databases/$(database)/documents/bundles/$(bundleId)).data.ownerId == request.auth.uid
          || isSuperAdmin());
    allow write: if false;
  }
}
// billingCharges/{id} — unchanged: SUPER_ADMIN read, write:false (already in place).
```

Rules tests (positive AND negative, per PLAN test plan): non-admin cannot read
`coupons` / `couponTemplates` / `monetization_alerts` / others' `bundles`;
SUPER_ADMIN can read all five; no client can write any of them.

---

## (b) system/config keys to set to ENABLE the alert job

The scheduled `monetizationAlerts` job mirrors `autoClosePools` exactly: it is a
no-op until explicitly enabled, and reports-only (dry-run) until explicitly told
to write. A missing/misread config = disabled (fail-safe). Set these on the
`system/config` doc under a `monetizationAlerts` map:

```
system/config = {
  ...,
  monetizationAlerts: {
    enabled: true,            // REQUIRED — job is OFF unless === true (default OFF)
    dryRun: false,            // set false to actually WRITE alert docs + send email
                              //   (default true → reports to admin_audit only)
    velocityThreshold: 10,    // optional — coupon >N live uses in 24h trips the
                              //   velocity spike (default 10; strictly greater-than)
    notifyEmail: "you@x.com"  // optional — recipient for the two ABUSE emails.
                              //   If omitted, the job emails every users/{uid}
                              //   with role == SUPER_ADMIN.
  }
}
```

Rollout recommendation (same as autoClose): enable with `dryRun:true` first,
review the `MONETIZATION_ALERTS_SWEEP` admin_audit summaries for a few cycles,
then flip `dryRun:false`.

Schedule: `every 6 hours`. Alert types written:
- `COUPON_VELOCITY_SPIKE`  (ABUSE — emails) — > velocityThreshold live uses / 24h.
- `COUPON_NEW_ACCOUNT_CLUSTER` (ABUSE — emails) — ≥3 live redemptions from
  accounts created <48h before redeeming.
- `COUPON_NEAR_MAX` (housekeeping — dashboard only) — live uses ≥ 80% of maxUses.
- `COUPON_EXPIRING` (housekeeping — dashboard only) — expires <7d with uses left.

De-dupe: alert docs are keyed `${TYPE}__${CODE}` so a re-run refreshes an open
alert rather than duplicating it; an already-`acked` alert that re-trips is
re-opened. The Wave-2 refund/dispute/double-charge alerts use their own doc ids
and are surfaced in the UI but not touched by this job.

Emails use the existing `mail` collection (Trigger Email) via
`reminders.sendEmail` with `category: 'transactional'` so they are never
suppressed by marketing opt-out.

---

## (c) Things NOT verified here (need a human / emulator / live data)

- **Email delivery.** The job writes to the `mail` collection with the correct
  transactional flags, but no mail was actually sent/received in this wave (no
  Trigger Email extension run). Verify with UAT #16 (drive a coupon past the
  velocity threshold → dashboard banner + email received).
- **Scheduled job against real data.** The detection logic is fully unit-tested
  (pure functions, 36 cases), but the `monetizationAlerts` orchestration
  (Firestore reads, `getAll` account lookups, upsert transactions, SUPER_ADMIN
  recipient query) was NOT exercised against a live/emulator Firestore. Run it
  with `enabled:true, dryRun:true` first and read the audit summaries.
- **Live ledger volume / query cost.** The accounting view reads up to 2000
  `billingCharges` rows and 2000 `bundles` client-side and aggregates in the
  browser. Fine for current volume; if the ledger grows large, add server-side
  aggregation or pagination (the `subscribeToBillingCharges` cap is a parameter).
- **`monetization_alerts` createdAt ordering.** The UI query orders by
  `createdAt desc`. Wave-2 alerts and this wave's alerts both write numeric
  `createdAt` (ms), so ordering is consistent; not re-verified against a mixed
  live set.
- **Coupon `usageLog` timestamps for velocity.** The 24h velocity window counts
  entries by `confirmedAt || reservedAt || usedAt`. Legacy usageLog entries with
  NO timestamp are excluded from the windowed count (cannot prove recency) — they
  still count toward near-max/remaining. This is intentional and unit-tested.

---

## Files created / changed this wave

New (backend):
- `shared/schemas/couponTemplate.ts` — template zod schema + `couponFieldsFromTemplate` mint helper (exported from `shared/schemas/index.ts`).
- `functions/src/lib/monetizationAlertLogic.ts` — PURE alert detectors (velocity / near-max / expiring / new-account cluster) + dedupe key.
- `functions/src/monetizationAlerts.ts` — scheduled sweep (kill-switch + dry-run, mirrors autoClosePools); exported from `index.ts`.
- `functions/src/couponTemplates.ts` — `createCouponTemplate` / `updateCouponTemplate` / `deleteCouponTemplate` / `mintCouponFromTemplate` / `acknowledgeMonetizationAlert` callables; exported from `index.ts`.
- `functions/src/__tests__/monetizationAlertLogic.test.ts` (36 tests), `functions/src/__tests__/couponTemplate.test.ts` (16 tests).

New (client):
- `src/components/admin/monetization/monetizationCalcs.ts` — pure revenue/liability/coupon derivations + formatters + Stripe deep-link.
- `src/components/admin/monetization/MonetizationDashboard.tsx` — owns the SUPER_ADMIN reads + 6 sub-tabs.
- `.../AccountingView.tsx`, `.../CouponUsagePanel.tsx`, `.../BundleLiabilityPanel.tsx`, `.../UserMoneyProfile.tsx`, `.../AlertCenter.tsx`, `.../CouponTemplates.tsx`.

Changed:
- `src/services/dbService.ts` — added Monetization read subscriptions + template/ack callable wrappers + read-shape interfaces (add-only).
- `src/components/admin/SuperAdminBillingPanel.tsx` — added an `'Accounting'` sub-tab mounting `MonetizationDashboard`.

Dev tooling (environment was under-provisioned in the worktree):
- `functions` devDependency `vitest@^2.1.9` was installed so the mandated
  `npm --prefix functions run test` runs. Root `npm install` was also run so the
  root `postcss.config.js` (tailwindcss) resolves and firebase-admin loads under
  vitest. No runtime/product code depends on these; they only unblock the test
  gate on a fresh checkout.
