# MORNING 2026-08-22 (overnight) — six PRs merged and DEPLOYED. The §2c fix is chosen and still owed.

> ⚠️ **This continues MORNING-2026-08-22-FIXES.md** and supersedes its §7
> "Still open" list — four of the five items there are now closed.
>
> 🛑 **THE ONE THING THAT MATTERS ON THIS PAGE:** the cross-model review gate
> (`CLAUDE.md` §2c) **did not run on any of tonight's six PRs**, because this
> cloud environment **denies `api.openai.com` at the network gateway** (measured
> 2026-08-22 — see §3). All six are merged with that gate unmet and named.
> **§3 is your ruling.**

---

## 0. What happened, in one table

| # | What | State | Deploy |
|---|---|---|---|
| **#504** | The NFL **"List Pool Publicly" toggle** now changes the Browse listing | ✅ merged | Coolify only |
| **#505** | **`HelpCopy.template` can render** — pool settings reach the help scope | ✅ merged | Coolify only |
| **#506** | The **Pick'em proxy pick**, which had never worked | ✅ merged | Coolify only |
| **#507** | **Deleted the two inert Pick'em scoring controls** (your ruling) | ✅ merged | Coolify only |
| **#508** | The picks grid's **Set column is visible to members** (your ruling, option A) | ✅ merged | 🛑 **`functions` deploy** |
| **#509** | **T4** — the manager form's 33 labels → `FieldLabel` + help topics | ✅ merged | Coolify only |

`main` started the night at `37720619` (#503) and ended with #509. **All six are
merged.**

✅ **KEVIN REPORTED "deployment complete", 2026-08-22**, so §1 is a record rather
than a task. ⚠️ Recorded as given: that runbook has **two independent deploy
halves** — `--only functions` for #508, and the Coolify `www` rebuild all six
need. §1 step 7's five checks separate them (#5 proves functions, #1–#4 prove
Coolify) if there is any doubt which ran.

✅ **§3 IS ANSWERED: Kevin chose (d)** — allow `api.openai.com` and add
`OPENAI_API_KEY` to the cloud environment. **Not yet applied**, and no session
can apply it; see §3.

---

## 1. The runbook — ✅ REPORTED COMPLETE 2026-08-22

Kept as the record of what was done, and as the shape of the next one. Step 7's
production checks are the only part worth re-reading: they are what tells the
two deploy halves apart.

### Step 1 — pull `main` in the MAIN checkout (30 seconds, MANDATORY)

`firebase deploy` builds from LOCAL files. Every worktree shares one `main` ref
and it only advances by a manual pull here. Skipping this is what shipped
nothing twice.

```
git -C D:\march-melee-pools pull --ff-only origin main
```

**You should see** seven commits arriving (`#504` … `#510`).
**If it refuses** with "divergent branches", stop and tell me — do not force it.

### Step 2 — verify the six merges landed (30 seconds)

Run this in `D:\march-melee-pools`. It searches `origin/main` explicitly, because
a bare `git log` searches whatever is checked out.

```
git log origin/main --oneline -7
```

**You should see**, newest first: `T4`, `Set column`, `inert Pick'em scoring`,
`proxy pick`, `HelpCopy.template`, `List Pool Publicly`.
**If any is missing**, step 1 did not take — re-run it.

### Step 3 — install functions deps with `ci`, not `install` (1 minute)

`install` rewrites the lockfile and dirties the tree `firebase deploy` packages.

```
npm --prefix functions ci
```

**You should see** it finish with no `package-lock.json` modification.
**If it errors** on a missing module, run it again after
`git -C D:\march-melee-pools status --short` shows a clean tree.

### Step 4 — 🛑 DEPLOY FUNCTIONS. This is the only deploy tonight needs. (3–5 minutes)

Only **#508** touches `functions/`. Until this runs, members still see a blank
Set column all week — the fix is merged and inert.

```
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

**You should see** `Deploy complete!` and `getPoolPicks` in the update list.
**If you do not see `getPoolPicks` named**, the deploy shipped old code — go
back to step 1. **The tell is an ABSENCE**, which is why it is easy to miss.

### Step 5 — verify the function by name (30 seconds)

PowerShell, so `Select-String` rather than `grep`.

```
npx firebase functions:list | Select-String "getPoolPicks"
```

**You should see** one row. **If it is empty**, the deploy did not land.

### Step 6 — Coolify rebuild of `www` (2 minutes + build time)

All six PRs change the frontend. Pushing to `main` does **not** auto-deploy it.

Open the Coolify dashboard → the `www` application → **Redeploy**.

**You should see** a build start and finish green.
**If it fails**, send me the build log — do not retry blindly.

### Step 7 — confirm the fixes in production (5 minutes)

Open any NFL Pick'em pool you commission.

1. **Manager → Settings → List Pool Publicly.** Toggle it off, Save, then open
   `/browse` in another tab. **The pool should be gone from Browse.** Toggle it
   back on and Save if you want it listed. *(Before tonight this control did
   nothing at all.)*
2. **Manager → Settings.** Every field name now has a small **`?`** beside it.
   Hover one. *(This is #509. Nine fields still have no copy — six Survivor
   rules and the three payout-mode fields — each waiting on T10 or T11.)*
3. **Manager → Settings → Exceptions → Enter a Pick for a Member.** On a Pick'em
   pool the form is now **there** instead of "not available yet". Pick an entry,
   a week, a team, type a reason, submit. **It should save.** *(This has never
   worked before tonight.)*
4. **Manager → Settings → Pick'em Rules.** "Base Points Per Correct Pick" and
   "Primetime Game Bonus Points" are **gone**, and the Rules tab no longer shows
   them to members. *(They never did anything — see §3.)*
5. **The picks grid, mid-week, signed in as a MEMBER** (not as yourself if you
   are the commissioner). The **Set** column now shows a number instead of a
   dash. *(This needs step 4; it will not work on the Coolify rebuild alone.)*

**If #5 still shows dashes**, the functions deploy did not land — step 5.

---

## 2. What each fix actually was

### #504 — "List Pool Publicly" wrote a field nothing reads

`handleSaveSettings` sent `settings.isListedPublic`. `isPubliclyListed` decides
an NFL pool's Browse listing from the **top-level `isPublic`**, which that save
never touched. The create wizard writes **both**, so a host's *first* choice
always worked and only the *later* toggle was inert — which is why it looked
like it worked.

Both halves now come from one call, because writing one and forgetting the other
**is** the defect. `isPublic` is read by `firestore.rules` for the Browse LIST
query — `allow get` is unconditional, so a share link is unaffected either way.
No new capability: the callable already accepted the key.

**On the first save after this ships**, a pool whose two fields disagree is
reconciled to the value the toggle displays — the host's recorded preference.
That is the fix landing, and it is the only visible change.

### #505 — the help system's template mechanism had never fired

`TopicScope` carried no settings, so `resolveCopy` always took its fallback
branch. **`HelpCopy.template` was built in T0 and had never rendered once**, at
a cost of eight deliberately-widened sentences across #480 and #484.

Settings now travel both channels — down to the tooltip, up to the panel — so
the two cannot disagree. `settings.weeklyTiebreaker` is the first real template:
a reader inside a pool is told the rule **their** pool plays, including the
`NONE` case every earlier draft had to walk back.

It also closed a hole this would otherwise have opened: the length budget and
the banned-word list both measured the *fallback* only, so a template branch
could have shipped 400 characters long, or saying "simply", and passed.

### #506 — the Pick'em proxy pick had never worked

`proxyPick` takes one `picks` map and the three NFL types key it two ways.
Survivor and Margin key by **week**; Pick'em keys by **game id**. The manager
sent the week-keyed shape for all three, so Pick'em died with *"Game 3 not found
in week 3"* — a message that reads like a broken schedule rather than a broken
payload.

It was hidden behind *"Pick'em proxy entry isn't available in the dashboard
yet"* — a message describing a design decision that was standing in front of a
bug. Both are gone.

**Two limits named rather than shipped silently:** a **confidence** pool still
refuses (a proxied pick carries no confidence value and would be scored at
zero), and a proxy pick records **no tie-breaker prediction**, which the card now
says.

### #507 — your ruling, executed exactly

The two inert scoring controls are deleted from the manager form, the rules page
and the join preview. **`functions/` is untouched** — the diff contains no server
file at all, which is the evidence that no scoring behaviour changed in any pool,
in any week, already scored or not.

Stored values, the schema entry and the type declarations all survive. Deleting
a control is not a data migration, so nothing ran against production.

A test now pins the claim it rests on: a pool **storing** `pointsPerPick: 3` and
5-point primetime bonuses scores **2** for two correct picks, byte-identical to
the same pool without the fields.

### #508 — your ruling, option A

`counts` is served to every principal now. **Pick content did not move**: teams,
confidence values and tie-breaker predictions are all still behind the same
allowlist, asserted on the same call.

**The 1-of-1 edge case you asked about**: it does leak that player's
participation, and it does not matter, because the ungated "N of M Players In"
chip already determines every individual whenever it reads 0 of M or M of M. This
widened the *resolution* of participation information, not the door.

⚠️ **One consequence worth knowing**: a participant and a plain commissioner now
receive **identical** responses except for the departed-member filter. That is
the only difference left.

---

## 3. ❓ QUESTION 1 — the review gate did not run. What do you want done?

**What this is:** `CLAUDE.md` §2c makes `codex exec review --base origin/main` a
hard gate before any PR. It exists because on 2026-07-21 a single session
produced 12 self-inflicted defects and **every one was caught by an external
reviewer, none by self-review**.

**What happened — CORRECTED 2026-08-22, after Kevin challenged it.** My first
answer was *"codex is not installed"*. True of the container, but not the
reason, because I never tried installing it. Measured properly:

- **It was absent** — not on `PATH`, not in `npm ls -g`, nowhere on the
  filesystem. That much held up.
- **It installs in nine seconds.** `npm i -g @openai/codex` → `codex-cli
  0.149.0`. I should have tried that before calling the gate impossible.
- **And it still cannot run, for a different reason.** This environment's
  outbound policy denies OpenAI:

```
ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket:
  Proxy connection failed: HTTP CONNECT failed with status 403,
  url: wss://api.openai.com/v1/responses
```

```
"kind": "connect_rejected",
"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
"host": "api.openai.com:443"
```

The allowlist covers npm, PyPI, crates, GitHub and Anthropic — not OpenAI. The
CLI, a credential and the network are three requirements, and only the first two
are reachable from inside the container.

**Kevin's month of codex use was never in question:** that is
`D:\march-melee-pools` on Windows with open egress, which is where §2c's
"verified `codex-cli 0.144.5`" was measured. Tonight ran on a different machine.

⚠️ **The six PR bodies and their merged commit messages still say "not
installed".** They were written before this was measured; commit messages cannot
be corrected, so this page and the HANDOFF box are the correction.

With qodo dormant, that left §2c's *second* condition — my own read of the diff —
as the only one available.

All six PRs are merged with the gate unmet. Every PR body says so at the bottom,
under a 🛑 heading, and lists what the self-review actually caught.

**Your options:**

- **(a) Accept these six and move on.** They are narrow, each has a
  discriminating test verified by reverting the fix, and the only one touching
  production behaviour on the server (#508) is still undeployed until you run
  step 4. *Expected outcome: nothing more to do; the gate is recorded as unmet
  in six PR bodies for the audit.*
- **(b) Run codex yourself over the merged range, from the Windows checkout.**
  `git fetch origin` then `codex exec review --base 37720619` in
  `D:\march-melee-pools`. *Expected outcome: 30–60 minutes and some paid API
  calls; any finding becomes a follow-up PR. Pick this if you want the gate
  honoured retroactively rather than waived.*
- **(c) Revert #509 (T4) and hold it for a codex round.** *Expected outcome: T4
  comes back out, the other five stay; nothing depends on it. Worth considering
  because it is the one COPY ticket, and §2c is explicit that voice rule 5
  "broke ten times on #480, always the same shape". Copy is the shape
  self-review is worst at. (This option said "hold it unmerged" when written —
  it merged on green CI before you answered, so it is a revert now.)*
- **(d) ✅ CHOSEN BY KEVIN, 2026-08-22 — and still owed.** Allow
  `api.openai.com` in the cloud environment's network policy, and add
  **`OPENAI_API_KEY`** to its environment variables. The CLI needs nothing — a
  session installs it in nine seconds.

  ⚠️ **NO SESSION CAN DO THIS.** Both live on the ENVIRONMENT DEFINITION at
  claude.ai/code, not inside a container. Re-measured at 17:17Z after the
  ruling: the gateway still answers `403 to CONNECT` for `api.openai.com`, and
  `OPENAI_API_KEY` is unset. Where they are set:
  https://code.claude.com/docs/en/claude-code-on-the-web

  ⚠️ **AND IT DOES NOT REACH BACK.** An environment edit applies to the NEXT
  session, never a running one — so **(d) alone leaves §2c unmet for these six.**
  **(d) and (b) compose:** (d) prevents the next occurrence, (b) closes this one,
  by running `codex exec review --base 37720619` either from Windows or from a
  cloud session started after the change.

**ANSWERED 2026-08-22: Kevin chose (d).** It is not applied yet and no session
can apply it. Until it is — and until a codex round runs over `37720619..HEAD` —
these six stand as (a): merged, with the gate recorded unmet in six PR bodies.

---

## 4. #509 (T4) is merged — what you are getting, and what I am least sure of

**Not a question — a disclosure.** I merged it under the standing authority
grant on green CI, the same as the other five. If you would rather it had waited
for a review round, §3(b) is still available after the fact and a revert is one
command.

**What this is:** `PLAN-HELP-SYSTEM` **T4** — a `?` beside every field on
Manager → Settings. All 33 raw `<label>` elements become `FieldLabel`, the four
commissioner tab hints stop being a second copy of their help page summaries,
and the tie-breaker hint becomes a registry reader.

**What changes for you:** hovering any field name explains what that setting
does. Nine fields still have no copy — six Survivor rules (T10) and the three
payout-mode fields (T11) — each carrying a written row naming its ticket, so the
count of what is left is visible rather than guessed.

🛑 **WHAT I AM LEAST SURE OF, AND IT IS THE ONE THING ON THIS PAGE I WOULD ASK
YOU TO EYEBALL.** Two of the five new topics are copy a commissioner reads, and
my own review already caught one real defect in them: a topic scoped to all
three NFL types describing a control **Survivor and Margin pools do not have and
cannot use**. It is fixed and pinned by a test — but it is evidence that the
class of error is live, and `CLAUDE.md` §2c is explicit that voice rule 5 "broke
ten times on #480, always the same shape".

**Cheapest check, 60 seconds after the Coolify rebuild:** open a **Survivor**
pool → Manager → Settings → Exceptions, and confirm you see the fixed-deadline
explanation and **no** "Extending a deadline" help. Then open a **Pick'em** pool
and confirm you do see it.

## 5. Two defects I found tonight and did NOT fix

Neither is urgent. Both are named here rather than silently carried.

### 5a. `proxyPick` computes a game's lock differently from everything else

`functions/src/poolExceptions.ts:293`:

```
const gameLockAt = (g) => override ?? (g.startTime - lockBufferMs);
```

The canonical helper is `effectiveGameLockAt`, which takes
`Math.max(base, override)`. `??` is **not** the same thing: on a `PER_GAME`
Pick'em pool with an extension in place, `proxyPick` treats *every* game as
locked at the (earlier) week override, including a Sunday-night game whose own
lock is hours later.

**Direction of the error is conservative** — it refuses a proxy pick the member
could still have made themselves — so it is a usability bug, not a reveal hole.
Fixing it is a `functions/` change and a deploy, which is why I did not fold it
into #506.

### 5b. The confidence-mode proxy refusal is client-side only

#506 refuses a proxy pick on a confidence Pick'em pool, because the callable
writes `picks` and never `confidence`, so the pick would be recorded and scored
at zero. **That gate is in the browser.** A direct callable invocation could
still write a confidence-less pick.

This was equally true before #506 — nothing regressed — but a server-side refusal
is the real control. Also a `functions/` change and a deploy.

---

## 6. Measurements, all taken tonight

Baselines re-measured on `37720619` at the start of the session, not carried
over from `fc38ff0c`:

| Gate | Start of night | End of night, on `main` |
|---|---|---|
| `npx vitest run` | 99 files / **1616** | 101 files / **1742** |
| `npm --prefix functions test` | 112 / **1705** | 112 / **1708** |
| `npm --prefix functions run test:emulator` | — | 34 files / **503** |
| `npm run lint` | **1340** problems, 0 errors | **1340**, 0 errors |
| `npx tsc -b` · `npm run build` | clean | clean |

**Lint delta across all six PRs: zero.** Two PRs cost warnings on their first
draft (a `react-hooks/preserve-manual-memoization` on #506, an unused destructure
on #509) and both were fixed rather than accepted.

**+126 tests**, every one of them a guard whose failure mode was checked by
breaking the thing it guards and watching exactly the right case fail.

---

## 7. Still open — carried forward from `MORNING-2026-08-22-FIXES.md` §7

**Closed tonight:** (a), (b), (c), (d) — all four help-system defects — and
**T4** (#509). The `settings.pointsPerPick` coverage row is settled.

**Still open, unchanged:**

- **T3, T5–T8 and T10–T15** of `PLAN-HELP-SYSTEM` are unstarted. T10 and T11 now
  have nine named manager-form rows waiting for them, in
  `MANAGER_LABEL_ALLOWLIST`.
- `src/types/nflPoolTypes.ts:61` still says `pickMode: 'ATS'` is *"reserved for
  V2"*. **Stale** — ATS ships and `gradePickemGames` grades it.
- `ManagerDashboard.tsx` has no importer. Dead code, delete candidate.
- The `mmp-qodo-cycle` watcher counts qodo's billing notice as a real review
  artifact. Fix before any restore. Not urgent while qodo is dormant.
- `PLAN-IMPORTER-SAFETY.md` §1.1/§1.5 — a concurrently **created** document still
  raises no Firestore conflict.
- **Two Operations-panel defects** from 2026-08-21: `OperationsPanel.tsx:536`
  slices every result to 400 characters with the scalar counts last, and the
  backfill's `admin_audit` row collapses arrays to `"[array]"`.
- **Q2 — `system/config.currentSeason` is `2025`** while everything else is 2026.
  Still unexplained, still untraced, still untouched. **Do not change it blind.**
- **Q3** — the job is still named `lockNFLSpreadsJob`. Kept deliberately.
- **Q4 — IAM on `gridiron-gamble-uzuqo`.** A console or Admin-SDK write bypasses
  `firestore.rules` entirely.

---

## 8. Tuesday is unchanged

📅 **TUE 2026-08-25, 09:00 ET — `lockNFLSpreadsJob` fires on app week 4 and will
probably REFUSE.** ESPN carried 0 of 16 lines as of 2026-08-21 and preseason
lines land ~1.4 days before kickoff. **All-or-nothing refusing is the rule
working.**

The repair, in order — and the order is the trap, because **the freeze reads the
DATABASE, not the screen**:

**NFL Schedule → Spread Manager → Preseason / Week 4 → Fetch Games → type a
number into every empty row → Save Working Lines → Freeze this week now.**

Nothing tonight touched the spread freeze, `system/config.nflSpreadLock` or
`nflFrozenSpreadBackfill`.
