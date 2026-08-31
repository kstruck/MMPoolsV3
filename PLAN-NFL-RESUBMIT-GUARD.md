# PLAN — the single-pick reuse guard must exempt the current week's own pick

**Status: WRITTEN 2026-08-06, alongside the code in [#384](https://github.com/kstruck/MMPoolsV3/pull/384). Code is COMPLETE and MERGE-READY; the DEPLOY is gated on Kevin and on the HOF game being final.**

Covers the two server defects banked during the 2026-08-05 overnight session.

## 0. Why this plan exists — and why it was nearly skipped

`mmp-change-control` §1 plan-gates a change touching **money, authorization,
production data, or scoring**. My first read said this PR trips none of them:

- Not **money** — no fee, payout, ledger or quote path.
- Not **authorization** — it decides whether a given *pick* is legal, not *who*
  may act. No rules, no `index.ts` exports, no role logic.
- Not **production data** as §1 defines it — that trigger is "backfills,
  migrations, sweeps, `fix*`/`recalculate*` ops — anything writing prod
  Firestore **outside a user's own normal flow**". A member submitting their
  own pick *is* their own normal flow.
- Not **scoring** — no engine, no grade, no standings row changes.

**qodo raised the missing plan as a `●● Moderate` rule violation on #384, and
on reflection it is right and my first read was too clever.** The guard being
changed is the mechanical enforcement of Survivor's central rule — one team per
season. That rule decides eliminations, eliminations decide the winner, and the
winner decides who gets the money. A change that is too permissive *here* is a
money defect two hops away, and §4 of `CLAUDE.md` says to take the gate when in
doubt rather than argue the taxonomy.

Written after the code rather than before, which is a deviation from Rule 3's
order and is recorded as one. The code was already written, reviewed and
mutation-tested when the gate question surfaced; re-doing it in the prescribed
order would have produced the same diff and thrown away the evidence.

## 1. Defect (a) — `TEAM_ALREADY_USED` on re-submitting the pick you already hold

### What is wrong

`functions/src/nflPools.ts`, Survivor and Margin branches of `submitNFLPicks`:

```ts
if (survivorEntry.usedTeams.includes(teamPicked)) {
  throw new HttpsError('invalid-argument', `TEAM_ALREADY_USED: ...`);
}
```

`usedTeams` is a **season-long ledger that already contains this week's own
saved pick** — it is written as `[...oldUsed, teamPicked]` a few lines below.
So the guard rejects the member's own current pick.

The write path immediately beneath it has always known better:

```ts
const oldUsed = survivorEntry.usedTeams.filter(t => t !== survivorEntry.picks[week]);
```

Two expressions, one concept ("teams used in weeks other than this one"), and
they disagreed. Neither is wrong in isolation, which is why no unit test of
either could have caught it.

### Blast radius

A member re-submitting the same team — double-checking, or a client retry after
a lost response — is told *"You have already picked the CAR this season."* and
the UI renders it as a **failed save**, about a pick that is safely in. On
kickoff night that reads as "my pick did not go through", and the natural
response is to pick a different team, which is a real behavioural harm rather
than a cosmetic one.

`#378` gave the client a local short-circuit so members stopped seeing it. That
does not fix the server, and it cannot help a retry, `proxyPick`, or any future
caller.

### The change

One `usedElsewhere` per branch, computed once, consumed by both the guard and
the write:

```ts
const usedElsewhere = survivorEntry.usedTeams.filter(t => t !== survivorEntry.picks?.[week]);
if (usedElsewhere.includes(teamPicked)) { throw ... }
```

### Why it cannot be too permissive

The exemption is exactly one team — the one already recorded for **this** week —
and it is derived from the entry's own `picks[week]`, not from client input.
Every other used team still rejects. Enumerated:

| `usedTeams` | `picks[week]` | submit | before | after |
|---|---|---|---|---|
| `[CAR]` | `CAR` | `CAR` | ❌ wrongly rejected | ✅ accepted |
| `[CAR, ARI]` | `CAR` | `ARI` | ❌ rejected | ❌ rejected (correct) |
| `[CAR, ARI]` | `CAR` | `BUF` | ✅ accepted | ✅ accepted |
| `[CAR]` | *(none)* | `CAR` | ❌ rejected | ❌ rejected (correct) |

The fourth row is the one that matters: with no pick for this week,
`picks?.[week]` is `undefined`, the filter removes nothing, and a team used in
an earlier week is still refused.

### ⚠️ One pre-existing hole this does NOT close, and does not widen

If a corrupt entry had the same team recorded for **two** weeks
(`picks = {1:'CAR', 3:'CAR'}`), the week-1 filter would exempt `CAR` even though
week 3 also holds it. That is unreachable through this callable — the guard
prevents it being created — and, critically, **the old write path used the
identical filter**, so the hole is inherited, not introduced. Not fixed here
because fixing it means changing what `usedTeams` *means*, which is a data
change and a separate gate.

## 2. Defect (b) — scoring reported "Week 1" where the UI said "HOF Weekend"

Preseason importer weeks are **offset** from the names fans use: importer week 1
is HOF Weekend, importer week 2 is "Preseason Week 1". Client surfaces have
rendered `nflWeekLabel` since it was introduced; `scoreNFLWeek`'s result
strings, audit messages and errors interpolated the raw importer number.

On the single night of the year when "Week 1" names two different slates, the
success message and the button that produced it disagreed.

`nflWeekLabel` moved to `shared/nflWeekLabel.ts`; `src/utils/nflWeekLabel.ts`
re-exports it. **One definition, not a copy plus a parity test.**

> ### ⚠️ `shared/` CHANGED
>
> `shared/` compiles into the functions bundle, so touching it makes a PR
> deploy-coupled. Acceptable **only because this PR already requires a functions
> deploy**. The opposite call was made in #382 hours earlier: `poolUsesSpreads`
> was *duplicated* into `src/utils/` specifically so a frontend-only fix would
> not owe a functions deploy on game day. Same judgement, different constraint.

Eight call sites render labels. **`Survivor rebuy (week N)` is deliberately
excluded** — it is a persisted payments-ledger note, so reformatting it is a
data-shape change under the **money** trigger. A test pins that it is still
there, so the omission is recorded rather than forgotten.

## 3. Evidence

`functions/src/__tests__/emulator/resubmitSameTeam.emulator.test.ts` — 8 cases,
`describe.each` over Survivor and Margin, exercising the real `submitNFLPicks`.

**Mutation-checked.** Reverting *only* the two guard expressions makes exactly
the 2 intended cases fail with the original error, and the other 6 keep passing:

```
Caused by: Error: TEAM_ALREADY_USED: You have already picked the CAR this season.
 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
```

The suite pins that a team used in a **different** week is still rejected, so a
"fix" that deleted the guard fails rather than passes. Its fixture games carry
`spread.locked: false` on purpose: neither pool type reads a spread, so a
regression of #382's gate scoping breaks these submits and the test says so.

| Gate | Result |
|---|---|
| `npx tsc -b` | clean |
| `npm run lint` | 0 errors |
| root `vitest run` | 773 / 773 |
| `functions` typecheck | clean |
| `functions` `vitest run` | 1334 / 1334 |
| `functions` `test:emulator` | 314 passed, 2 expected-fail, 10 skipped |
| `npm run build` | ok |
| `codex exec review --base origin/main` | clean |
| qodo | 0 bugs; this plan is the one accepted finding |

## 4. Deploy plan — GATED ON KEVIN

**Preconditions, all of them:**

1. The Hall of Fame game (CAR @ ARI, 2026-08-06 20:00 ET) is **FINAL**.
2. Every NFL pool has been scored and the results confirmed.
3. Kevin has explicitly said go.

**Then**, from `D:\march-melee-pools` on `main`:

```
npm --prefix functions ci
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

`ci`, not `install` — `install` rewrites the lockfile and dirties the tree that
`firebase deploy` packages.

Certification is a **second** full-fleet run reporting every function
`Skipped (No changes detected)` and `✔ Deploy complete!`.

**Rules are NOT deployed** — `firestore.rules` and `firestore.indexes.json` are
untouched by this PR.

**No Coolify rebuild is owed — measured, not assumed.** `src/utils/nflWeekLabel.ts`
does change, so the usual rule says one is. It is not: the change makes that file
a **re-export** of `shared/nflWeekLabel.ts` rather than a definition, and Vite
inlines the result identically. Both branches were built and their emitted assets
compared — **byte-identical filenames**: `index-3vC8k8ii.js`, `index-Y-VDW8GS.js`,
`PoolRoute-CYo6vqHW.js`.

This is HANDOFF's documented case from the other direction — *"a `src/**` change
confined to code the tree-shake drops emits byte-identical assets and leaves the
hash alone"*. So if a rebuild is run anyway it is harmless, and its **unchanged
hash is the expected result here, not a failed deploy**.

The same correction applies to the rollback in §5.

## 5. Rollback

Revert the merge commit and redeploy functions. There is no data migration and
no persisted-shape change, so a revert is complete: `usedTeams` documents
written under the fix are indistinguishable from ones written before it — the
fix changes which submits are *rejected*, never what a successful submit
*stores*.
