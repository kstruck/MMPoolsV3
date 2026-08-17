# ADR 0008: Prizes are DISPLAYED until RECORDED — the ledger records, the scorer only publishes

Date: 2026-08-17
Status: Accepted (PLAN-WEEKLY-PRIZES signed 2026-08-15; PLAN-PAYMENT-LEDGER K1–K12 signed 2026-08-15; shipped #451–#456, #460, #464, #465, this PR)

## Context

ADR 0005 Phase 4 established Payout Records as the sole source of the prizes
side of Profit: the platform never fabricates a payout a Commissioner did not
record. Weekly prizes (PLAN-WEEKLY-PRIZES) then gave the scorer something to
say about money every week — a ranking and a frozen prize per place — and the
obvious shortcut was to have the scorer write the Payout Records itself.

That shortcut was rejected (K3, the invariant). A scorer that records payouts
turns every rescore into a money correction the Commissioner never made, and
makes "the platform moves no money" false in spirit: a figure nobody confirmed
would count in Profit.

## Decision

- **The scorer PUBLISHES; only the Commissioner RECORDS.** Publication is a
  ranking plus a frozen prize per place — on the week's recap
  (`weeklyPlaces` + `weeklyPrize`) and, at finalization, on the pool
  (`seasonPlaces` + `seasonPrize`). It is displayed everywhere (recap card,
  member Payments "My prizes", commissioner Payment Ledger) as an **estimate**.
- **A prize becomes a Payout Record only when the Commissioner ticks it** in the
  Payment Ledger. `recordPoolPayouts` BINDS that record to the publication
  (entry owner, place = published rank, amount = published prize) at a
  **deterministic id** — `wk{week}-{entryId}-p{place}` / `season-{entryId}-p{place}`
  — so a double-click, a retry or two tabs record once (K11).
- **The publication wins after a rescore (K12).** A live bound record that no
  longer matches shows STALE; the Commissioner re-records via `staleAwardId`
  (supersession, `~k` suffix, settlement carried over) or reverses to $0. The
  ledger never silently keeps a stale award and never silently replaces one.
- **Frozen, never re-priced.** The prize snapshot is frozen at first
  publication (`null` = published unpriced); a later settings edit cannot
  retroactively price a published week or season. Players re-rank; pots do not
  move.
- **Free-form awards survive as "Other awards"** (BONUS / ADJUSTMENT, no
  entry, random id, corrected by `supersedes`) inside the same ledger — the
  Record Payouts card is gone.

## Consequences

- Profit is exact by construction: it sums records a human made, each equal to
  a figure the scorer published.
- The Commissioner has one place to look for money (the ledger) and one act to
  perform (tick).
- Known gap: the `null` (unpriced) sentinel is sticky by design; a Commissioner
  who fixes the payout settings after a week published unpriced has no in-app
  re-price. Ticketed 2026-08-17.
