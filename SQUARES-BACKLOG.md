# SQUARES — the post-launch fix list

**Status: CREATION IS CLOSED.** `SQUARES_CREATION_OPEN = false`
(`src/config/season.ts`). Nobody can create or buy a squares pool, super admins
included. Existing squares pools are untouched — they still open, score and pay
out.

**Kevin, 2026-08-28:** *"If there are issues with the Squares pools, make that a
priority for post-launch and do not allow any Squares pools from being purchased
or setup for now. Add a COMING SOON to those. Ensure that any fixes for the
squares pools are listed somewhere for me to pick up later today or later this
week. DO NOT FORGET THEM."*

**This file is that list.** Nothing here is fixed. `tests/squares-creation-closed.test.ts`
holds the closure shut and goes RED the day S1 lands, which is the signal to
reopen creation rather than leave a "Coming Soon" on a product that works again.

---

## S1 — 🔴 THE BLOCKER. A default squares pool is unplayable by anyone but its commissioner

**Kevin's decision, 2026-08-28: `0` MEANS UNLIMITED. Approved as recommended.**
Build it this way when squares reopens.

### The defect, verified line by line

| # | File:line | What it does |
|---|---|---|
| 1 | `src/components/wizard/create/CreateSquaresPool.tsx:43` | wizard default `maxSquaresPerPlayer: 0` |
| 2 | `src/components/wizard/create/CreateSquaresPool.tsx:29` | label: `Max squares per player (0 = no limit)` |
| 3 | `src/components/wizard/create/buildSquaresPayload.ts:26` | sends `Number(v.maxSquaresPerPlayer ?? 0)` |
| 4 | `shared/schemas/squares.ts:10` | `z.number().int().min(0).optional()` — 0 is storable |
| 5 | `functions/src/squares.ts:93` | `if (mySquares >= pool.maxSquaresPerPlayer && pool.ownerId !== userId) throw` |
| 6 | `functions/src/squares.ts:94` | `resource-exhausted`, `"Max 0 squares per player."` |

At 0 a non-owner's first claim evaluates `0 >= 0` → `true` → refused. **Nothing
anywhere implements "no limit."** The label at row 2 is false.

### FIVE client readers, five different meanings for the same 0

| File:line | Reads 0 as |
|---|---|
| `src/components/Grid.tsx:156` | `Number(...) \|\| 100` → **100** |
| `src/components/routes/PoolRoute.tsx:439` | `Number(...) \|\| 10` → **10** |
| `src/components/routes/PoolRoute.tsx:595` | `... \|\| 'N/A'` → **"N/A"** |
| `src/components/routes/PoolRoute.tsx:908` | `... \|\| '∞'` → **"∞"** |
| `src/components/StatusCard.tsx:107` | `... \|\| 'N/A'` → **"N/A"** |
| `functions/src/squares.ts:93` | **0 — refuse everything** |

`src/components/admin/WizardStepSummary.tsx:121` renders the raw `0`, and the
LEGACY admin wizard `src/components/admin/WizardStepRules.tsx:39-40` writes
`parseInt(e.target.value) || 0`, so it can produce a 0 too. `src/constants.ts:33`
seeds the legacy default at **10**, so legacy-created pools are not affected.

### The fix, as approved

1. `functions/src/squares.ts:93` — apply the cap only when one is actually set:
   ```ts
   const cap = Number(pool.maxSquaresPerPlayer);
   if (Number.isFinite(cap) && cap > 0 && mySquares >= cap && pool.ownerId !== userId) throw ...
   ```
   This also preserves today's behaviour for pools where the field is ABSENT —
   `mySquares >= undefined` is already `false`, i.e. already unlimited.
2. One shared helper replacing the five disagreeing readers: `Grid.tsx` bounds
   selection by the grid itself when unset; `PoolRoute.tsx:439` skips the client
   pre-check (the server is the gate); `:595`, `:908` and `StatusCard.tsx:107`
   render **one** string.
3. Label at `CreateSquaresPool.tsx:29` stays — it becomes true.
4. `src/help/content/squares-props.ts` topic `maxSquaresPerPlayer` rewritten.
5. `tests/help-content-squares-props.test.ts` lines 90–115 are a DELIBERATE
   DRIFT PIN that asserts the defect still exists. It is **designed** to go red
   on this fix; invert it in the same PR.
6. Flip `SQUARES_CREATION_OPEN` back to `true` and delete
   `tests/squares-creation-closed.test.ts`'s "defect is still there" block.

**Deploys: `npx firebase deploy` AND a Coolify redeploy.** Plan-gated
(authorization on a money surface) — the plan of record is
`PLAN-SQUARES-ZERO-LIMIT.md` on branch `claude/squares-zero-limit-plan`.

**Past pools:** Kevin, 2026-08-28 — *"Ignore any past pools as they are done."*
No migration needed; the fix repairs them anyway the moment it deploys.
A read-only census exists if it is ever wanted:
`functions/scripts/censusSquaresMaxPerPlayer.mjs`.

---

## S2 — 🟡 `settings.gridSize` is written and read by NOTHING

`buildSquaresPayload.ts:31` sends it, `src/types/index.ts:398` and
`functions/src/types.ts:147` declare it, `src/constants.ts:37` defaults it.
**Zero readers in `src/` or `functions/`.** The grid is 10×10 by construction.

Either delete the field, or implement it. Harmless today because the wizard
renders no control for it — but it is a lie in the data model, and the next
person to add a "grid size" control will assume it works.

---

## S3 — 🟡 Squares pools are exempt from the free-plan participant cap

`nflPools.ts:338`, `bracketEntries.ts:48`, `playoffPools.ts:213` and
`propBets.ts:77` all refuse the 11th participant on a `free` pool.
**`reserveSquare` has no such check** — only `checkBillingAccess`. So a free
squares pool takes unlimited claimers.

Decide deliberately: it is either a deliberate exemption (a 100-square grid is
one game, not a season) or a hole in the monetisation. Right now it is neither —
it is unstated.

---

## S4 — 🟢 The claim path stores a NAME, not a uid

`functions/src/squares.ts:92` counts `squares.filter(s => s.owner === userName)`
and `:102` stores `owner: pickedAsName || userName`. Two players with the same
display name share a limit; a player who changes their name resets it. The code
says so itself at `:85` and `:103`.

Not urgent, but it is the reason S1's cap can be evaded by typing a different
name, so fix it in the same pass as S1 or accept it knowingly.

---

## What is NOT broken about squares

- **PROPS pools are unaffected.** `PropsWizard.tsx:151` also writes
  `maxSquaresPerPlayer: 0`, but props claims go through
  `functions/src/propBets.ts:56`, which reads `props.maxCards || 1` — a separate
  field with a working fallback. A props pool never calls `reserveSquare`.
- **Existing squares pools still work** for everything except a new claim on a
  grid stored at 0.
- Scoring, payouts, the grid UI and the number-set draw are untouched by any of
  the above.
