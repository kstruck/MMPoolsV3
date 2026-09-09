# PLAN — an empty pick'em submission must not start a fee

**Status: 🛑 AWAITING KEVIN'S SIGN-OFF ON §6. No code has been written.**

Plan-gated under `mmp-change-control` §1: this changes **when a member owes
money**, which is the *money* trigger. The gate is PLAN → adversarial review log
→ sweeps → sign-off → implement, in that order. Only the PLAN step is done.

**Every claim below is measured against `origin/main` @ `43c00f09`** (the SHA at
the time of writing — `git fetch origin` and re-read `git rev-parse origin/main`
before acting on it). File and line references are from that tree.

---

## 1. The defect, stated exactly

`submitNFLPicksInternal` ends by calling `ensureMemberRecord` with
**`hasPlayableEntry: true` unconditionally** (`functions/src/nflPools.ts:750`),
no matter whether the submission actually stored a pick.

That flag is the switch on a seeded commissioner's fee
(`functions/src/lib/memberRecord.ts:74-76`):

```ts
const liableFee = facts.entryFee === undefined
  ? undefined
  : (facts.role === 'MANAGER' && !facts.hasPlayableEntry ? 0 : facts.entryFee);
```

and on the update branch (`:124-126`) `feeOwed` is upgraded when it is currently
`0` and `liableFee` is now positive:

```ts
if (liableFee !== undefined && (existing.feeOwed === undefined || (existing.feeOwed === 0 && liableFee > 0))) {
  data.feeOwed = liableFee;
  data.feeOwedSource = 'LIVE';
}
```

So: **a pool MANAGER whose `feeOwed` is 0 because they had not yet played can
submit `picks: {}` and have `feeOwed` upgraded from 0 to the full entry fee — a
charge for a pick nobody made.**

### Why `picks: {}` reaches the handler at all

`submitNFLPicksSchema` permits it — `picks` is a record with a `<= 50` key cap
and **no minimum** (`functions/src/schemas/poolCore.ts:31-33`) — and the pick'em
branch of the handler does not require a selection. The code says so in its own
words at `nflPools.ts:502-504`, which is how this was found: the
commissioner-blind-picks work already had to defend `pickedWeeks` against the
same input and left the note behind.

**Survivor and Margin are NOT affected.** Both branches throw before reaching the
member write when no team is supplied, and both set `committedPickForWeek = true`
immediately after their own guard (`:666`, `:729`). This is a pick'em-only shape.

### The same input is already handled correctly one field over

`committedPickForWeek` (`:509-510`, `:574`) exists and is **already correct**:

```ts
const weekGameIds = new Set(games.map(g => g.id));
...
committedPickForWeek = Object.keys(picks).some(gameId => weekGameIds.has(gameId));
```

It gates `pickedWeek` on the very same call (`:755`) and it gates it *right next
to* the unconditional `hasPlayableEntry: true`. One line in that object literal
respects the fact and the line above it does not.

---

## 2. Blast radius — measured, and smaller than it sounds

| Who | Effect | Why |
|---|---|---|
| Pool **MANAGER** (the seeded commissioner) with `feeOwed: 0` | ⚠️ **`feeOwed` 0 → entry fee.** The defect. | `liableFee` is 0 for them only while `!hasPlayableEntry` |
| **PARTICIPANT** | none | They owe `entryFee` from the moment they join; `liableFee` never depended on the latch for them |
| MANAGER whose `feeOwed` is already the fee | none | The update branch never lowers, and there is nothing to raise |
| Survivor / Margin members of any role | none | Their branches throw before the member write |

**No client can currently produce the input.** `PickemPickEntry`'s `canSubmit`
requires every game picked (and, in confidence mode, a unique weight on each), so
the sheet cannot send `{}`. The exposure is the **callable**, which is public to
any authenticated member of the pool: a direct call, a replayed request, or a
future client. That is the same shape as the `proxyPick` bug closed 2026-07-31 —
the schema allowed something the UI never sent, and the handler trusted the UI.

⚠️ **This is a LIVE production surface.** `submitNFLPicks` is deployed and the
2026 preseason pilot is running. It is not reachable from today's UI, which is
why this is a plan and not a page.

---

## 3. What has NOT been measured, and must be before implementing

| # | Question | How to answer |
|---|---|---|
| M1 | **Has this already fired in production?** Count Member Records with `role: MANAGER` and `hasPlayableEntry: true` whose pool is `NFL_PICKEM`, then check each against entry evidence for an actually-stored pick. | Read-only census script under `.claude/skills/mmp-diagnostics-and-tooling/scripts/`, same pattern as `firestore-census`. **Needs credentials this machine does not have** — Kevin's to run, or run from Cloud Shell |
| M2 | Does any **other** caller pass `hasPlayableEntry: true` on a path where no pick was stored? `poolExceptions.ts:480` is the second call site. | Read `proxyPick`'s guard; it was hardened 2026-07-31, so the expectation is that it already refuses an empty pick — confirm rather than assume |
| M3 | Does anything **read** `hasPlayableEntry` in a way that a `false`/absent value would break — standings, payouts, the roster? | `buildMemberStandings` is documented (`memberRecord.ts:113-116`) to keep a member off the leaderboard without the latch or a scored row. Confirm there is no second reader |

**M1 decides whether a repair is owed on top of the fix.** M2 and M3 decide
whether the fix is one line or three.

---

## 4. Proposed fix

**One line**, at `functions/src/nflPools.ts:750`:

```ts
-      hasPlayableEntry: true,
+      // Only a submission that actually stored a pick starts fee liability.
+      // `picks: {}` is schema-legal and reaches here; without this a seeded
+      // MANAGER's feeOwed upgrades 0 -> fee for a pick nobody made.
+      hasPlayableEntry: committedPickForWeek,
```

`committedPickForWeek` is `true` on every Survivor and Margin path that reaches
this line, so **those two pool types are bit-for-bit unchanged**.

### The one judgement call this fix contains

`committedPickForWeek` requires a pick **for the submitted week**. A pick'em
submission whose keys all belong to a *different* week therefore would not latch
the flag. Two readings:

- **It is correct.** The member did not play the week they submitted, and the
  handler's own comment (`:505-507`) already treats cross-week keys as "did not
  pick this week" for `pickedWeeks`. Using one predicate for both keeps them from
  disagreeing.
- **It is too strict.** Fee liability is arguably about "has this member ever
  played", not "did they play *this* week" — and `hasPlayableEntry` is a one-way
  latch whose name says "ever".

⚠️ **These differ only for a submission that stores picks exclusively for another
week, which no client produces.** The recommendation is the first reading —
**one predicate, not two** — because a second predicate is a second thing to keep
correct and the case it distinguishes is unreachable. Recorded here so the choice
is visible rather than implied.

---

## 5. Repair of existing data — proposed: NONE

Consistent with the standing fix-forward rulings on this repo (survivor
exemptions 2026-08-09, `pickedWeeks` 2026-08-12).

**Reasoning:** lowering a `feeOwed` that a commissioner may already have
collected against would be a money change applied to closed business. And the
update branch deliberately never lowers `feeOwed` (`memberRecord.ts:120-123`) —
fee changes cascade through the entryFee-edit path — so a repair would have to
go around an invariant rather than through it.

⚠️ **M1 can overturn this.** If the census finds real affected records the
decision changes from "nothing to repair" to "Kevin decides per pool", and this
section is rewritten before implementation.

---

## 6. 🛑 Questions for Kevin — sign-off gate

> ✅ **SIGNED 2026-08-15 by Kevin — "all recommendations"** (asked and answered in the session that opened the T1 lock PR; every row below stands as recommended).

| # | Question | Recommendation |
|---|---|---|
| **Q1** | Fix it at all, or accept it as unreachable-from-the-UI? | **Fix.** It moves money, the callable is public, and it is a one-line change with a test. The `proxyPick` sibling was accepted as worth fixing on the same reasoning. |
| **Q2** | One predicate (`committedPickForWeek`) or a looser "stored any pick at all"? | **One predicate** — §4. They differ only on input no client sends. |
| **Q3** | Repair existing records, or fix-forward? | **Fix-forward** — §5, pending M1. |
| **Q4** | Should the handler also **reject** an empty pick'em submission outright (`400 NO_PICKS`) rather than accepting it as a no-op write? | **No, not in this change.** Rejecting is a behaviour change to a live callable with its own blast radius (a client that submits an unchanged empty sheet would start failing). The fee fix stands alone and is strictly safer. Worth its own ticket. |

---

## 7. Implementation order, once signed off

> **Status 2026-08-15:** implemented in one PR. M2 confirmed (`proxyPick` stores a concrete `teamPicked` — never an empty pick); M3 confirmed (`memberRecord.ts` is the only reader: `feeOwed` for a MANAGER, the standings latch, the one-way latch on update — an absent/false value keeps a manager at $0, which is today's behaviour). **M1 (has it fired in prod?) is still Kevin's to run** — needs credentials this machine does not have; §5 (fix-forward, no repair) stands until it says otherwise.

1. Run M1/M2/M3. If M1 finds affected records, rewrite §5 and re-gate.
2. Write the failing test first: `submitNFLPicksInternal` with `picks: {}` on an
   `NFL_PICKEM` pool, actor = seeded MANAGER with `feeOwed: 0`, asserting
   `feeOwed` stays 0 and `hasPlayableEntry` is not latched. It must fail on
   `origin/main`.
3. Apply the one-line change.
4. Add the mirror-case test: the same actor submitting one real pick DOES latch
   and DOES upgrade `feeOwed` — a fix that never latches would pass step 2 and be
   badly wrong.
5. Full gate set: root vitest, functions vitest, emulator, typecheck ×2, lint.
6. codex on the diff, qodo on the PR, own read. Joint stopping rule.
7. **PR body must say the change deploys into a LIVE scorer** and owes a
   **functions deploy** on merge. No rules change, no Coolify rebuild.

---

## 8. Provenance

- Found: 2026-08-12, during #414 (commissioner-blind picks), recorded in that
  PR's body and in `docs/archive/MORNING-2026-08-12.md` §6 as "found and deliberately NOT
  fixed — it moves money, so it is plan-gated and was out of #414's bounds".
- This plan: written 2026-08-13 overnight, against `43c00f09`, from the source
  rather than from the earlier write-up. Every line reference in §1 was read.
- Sibling: the `proxyPick` bug of the same class, closed 2026-07-31.
