# PLAN-SQUARES-ZERO-LIMIT — a squares pool left on its default cannot be played

**Status:** AWAITING KEVIN'S SIGN-OFF (written 2026-08-27, overnight session)
**Gate:** PLAN-GATED. `mmp-change-control` §1 trigger = **authorization** (the
claim check in `reserveSquare` decides who may take a square) on a **money**
surface (each square is a paid entry). Possibly **production data** — see §4.
**Launch impact:** BLOCKER. Kevin sends invites 2026-08-28.

---

## 1. The defect, verified line by line

A SQUARES pool created through the unified wizard and left on its default
**cannot be played by anyone except the commissioner.** The first non-owner to
claim their first square is refused.

| # | File:line | What it does |
|---|---|---|
| 1 | `src/components/wizard/create/CreateSquaresPool.tsx:43` | wizard default `maxSquaresPerPlayer: 0` |
| 2 | `src/components/wizard/create/CreateSquaresPool.tsx:29` | label: `Max squares per player (0 = no limit)` |
| 3 | `src/components/wizard/create/buildSquaresPayload.ts:26` | sends `Number(v.maxSquaresPerPlayer ?? 0)` |
| 4 | `shared/schemas/squares.ts:10` | `z.number().int().min(0).optional()` — 0 is storable |
| 5 | `functions/src/squares.ts:93` | `if (mySquares >= pool.maxSquaresPerPlayer && pool.ownerId !== userId) throw` |
| 6 | `functions/src/squares.ts:94` | `resource-exhausted`, `"Max 0 squares per player."` |

At 0, a non-owner's first claim evaluates `0 >= 0` → `true` → refused.
**Nothing anywhere implements "no limit".** The label at row 2 is false.

### 1b. FIVE client readers, five different meanings for the same 0

The session brief named four. There are five; `StatusCard.tsx` is the fifth.

| File:line | Reads 0 as |
|---|---|
| `src/components/Grid.tsx:156` | `Number(...) \|\| 100` → **100** |
| `src/components/routes/PoolRoute.tsx:439` | `Number(...) \|\| 10` → **10** |
| `src/components/routes/PoolRoute.tsx:595` | `... \|\| 'N/A'` → **"N/A"** |
| `src/components/routes/PoolRoute.tsx:908` | `... \|\| '∞'` → **"∞"** |
| `src/components/StatusCard.tsx:107` | `... \|\| 'N/A'` → **"N/A"** |
| `functions/src/squares.ts:93` | **0 — refuse everything** |

`src/components/admin/WizardStepSummary.tsx:121` renders the raw value (`0`), and
the LEGACY admin wizard `src/components/admin/WizardStepRules.tsx:39-40` writes
`parseInt(e.target.value) || 0`, so it can produce a 0 too. `src/constants.ts:33`
seeds the legacy default at **10**, so legacy-created pools are not affected.

### 1c. NOT affected

- **PROPS pools.** `PropsWizard.tsx:151` also writes `maxSquaresPerPlayer: 0`,
  but props claims go through `functions/src/propBets.ts:56`, which reads
  `poolData.props?.maxCards || 1` — a separate field with a working `|| 1`
  fallback. A props pool never calls `reserveSquare`.
- **BRACKET / PLAYOFF simulators** (`bracketSimulator.ts:112`,
  `playoffSimulator.ts:105`, `propsSimulator.ts:83`) set 0 on pool types that
  never call `reserveSquare`.
- **Pools where the field is absent.** `mySquares >= undefined` is `false`, so an
  old pool missing the field already behaves as unlimited. The fix must keep it
  that way.

---

## 2. THE DECISION — this is what needs sign-off

**Does `0` mean "no limit", or is `0` invalid?**

### Option A — 0 means "no limit" (RECOMMENDED)

Make the label true. One guard in the callable, five client readers reconciled
to the same meaning, help copy rewritten.

- `functions/src/squares.ts:93` → apply the cap only when a real cap is set:
  ```ts
  const cap = Number(pool.maxSquaresPerPlayer);
  if (Number.isFinite(cap) && cap > 0 && mySquares >= cap && pool.ownerId !== userId) throw ...
  ```
  This also preserves today's behaviour for pools where the field is absent.
- `Grid.tsx:156` → no cap when unset; selection bounded by the grid itself.
- `PoolRoute.tsx:439` → skip the client pre-check when unset (server is the gate).
- `PoolRoute.tsx:595`, `PoolRoute.tsx:908`, `StatusCard.tsx:107` → one shared
  helper, one string: **"No limit"** (or ∞ where the tile is numeric).
- Label at `CreateSquaresPool.tsx:29` stays as written — it becomes true.
- Wizard default stays `0`.
- `src/help/content/squares-props.ts` topic `maxSquaresPerPlayer` rewritten.

**Why this one:**
1. **It needs no production-data answer.** Any pool already stored at 0 starts
   working the moment the function deploys. Option B cannot fix those without a
   prod-data migration (§4).
2. It matches the commissioner's stated intent — the label is what Kevin wrote.
3. It is a *widening* of an authorization check, from "refuse everyone" to
   "refuse nobody when no cap is set". It cannot refuse a claim that is
   currently allowed.

**Cost:** touches `functions/` → needs `npx firebase deploy` as well as the
Coolify frontend redeploy. Both are Kevin's, both are on tomorrow's list anyway.

**Product consequence to be aware of:** a commissioner who leaves the default
gets a grid with **no per-player cap** — one player could take all 100 squares.
That is a social problem, not a broken pool. Today it is a broken pool.

### Option B — 0 is invalid; force a real number

- `CreateSquaresPool.tsx` → `min={1}`, default `100` (a full 10×10 grid), label
  rewritten to drop "0 = no limit".
- `shared/schemas/squares.ts:10` → `.min(1)`.
- Client readers reconciled to "there is always a number".
- **No `functions/` change → no `firebase deploy`, Coolify only.**

**Why not:** it fixes only pools created *after* the redeploy. Every pool already
stored at 0 stays unplayable and needs a production Firestore write to repair
(§4). It also deletes a setting Kevin deliberately offered.

### Option C — A, plus change the wizard default to a real number (e.g. `100`)

Belt and braces: 0 still means no limit for anyone who types it, but a
commissioner who touches nothing gets an explicit full-grid cap.

**Why not (as the first move):** it changes two things at once on a launch-eve
PR, and the second change buys nothing on a 10×10 grid — a cap of 100 and "no
limit" are the same rule. Easy to add later if Kevin wants the number visible.

### Option D — ship nothing; tell Kevin to type a number before inviting

Rejected. The wizard default is the trap, and every future commissioner walks
into it. Also leaves the false label shipped.

---

## 3. What "approve as recommended" means

I implement **Option A** in one PR:

1. `functions/src/squares.ts` — the guard above.
2. `Grid.tsx`, `PoolRoute.tsx` (×3), `StatusCard.tsx` — one shared helper for
   "is there a cap" + "how to render it", so five readers stop disagreeing.
3. `src/help/content/squares-props.ts` — the `maxSquaresPerPlayer` topic
   rewritten to describe the fixed behaviour.
4. `tests/help-content-squares-props.test.ts` — the DRIFT PIN (lines 90–115)
   inverted. It is *designed* to go red on this fix; the new assertions pin the
   zero guard's presence and the new copy, so the copy still cannot outlive the
   code.
5. New behaviour tests (Kevin's standing "ships with a test" rule):
   - a functions unit/emulator test: a non-owner CAN claim on a pool stored at
     `0`, and IS still refused at `mySquares >= cap` when the cap is `> 0`;
   - a client test for the shared helper across `0`, `undefined`, `5`.
6. Every guard mutation-tested: break it, observe red, restore, report the red.

Gates: all seven. Codex review `--base origin/main`, cap 10 rounds.
**Deploys needed: `npx firebase deploy` AND a Coolify frontend redeploy.** Both
Kevin's, both in the morning list.

---

## 4. The production-data question — UNVERIFIED, and Option A makes it moot

**Do any live SQUARES pools already have `maxSquaresPerPlayer: 0` stored?**

I have **not** checked: reading production Firestore needs a service-account key
this session should not go looking for, and the answer does not change the
recommendation. A **read-only** census that answers it in one command ships with
this plan — `functions/scripts/censusSquaresMaxPerPlayer.mjs`. It never writes.
It applies the server's own comparison (`0 >= maxSquaresPerPlayer`) to a
hypothetical first claim, and counts the absent-value pools separately because
`0 >= undefined` is `false` — those already behave as unlimited and are not
affected either way.

- Under **Option A**: irrelevant. Those pools become playable on deploy. **No
  production write of any kind.**
- Under **Option B**: it becomes a required prod-data migration — a plan-gated,
  kill-switched, dry-run-first backfill setting every 0 to a real number. That is
  a second plan and a second night's work, on launch eve.

This asymmetry is the strongest single argument for A.

---

## 5. Blast-radius classification (stated in full, per `mmp-change-control` §1)

| Trigger | Touched? |
|---|---|
| **Money** | Yes — squares are paid entries; the check gates who may buy one. |
| **Authorization** | Yes — `reserveSquare`'s claim gate. Change is a widening only. |
| **Production data** | No under Option A (no writes). Yes under Option B. |
| **Scoring** | No. Nothing in the scoring engines is touched. |

Not touched: `firestore.rules`, `functions/src/index.ts` exports, the NFL
scorer (`nflAutoScoreJob` runs `*/5` in production — untouched).
