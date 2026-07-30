---
name: mmp-qodo-cycle
description: >
  LIVE again as of 2026-07-30 — Kevin's qodo subscription is active and he
  asked for the check on every PR (CLAUDE.md §2b). **Load this the moment you
  OPEN a PR or mark one ready for review — not when a report arrives.** The
  watcher that detects the report lives in here, so waiting for a report
  before loading the skill is circular and the check never runs. Covers
  arming the watcher, pulling ALL three comment surfaces (any one can be
  empty, so a report is not absent until all three are), making a validity
  call on every finding BEFORE fixing, rerunning the full gate set, and
  reporting a per-finding verdict table. Runs ALONGSIDE codex (CLAUDE.md
  §2c), not instead of it.
---

# mmp-qodo-cycle — absorb a qodo.ai PR review autonomously

> ✅ **LIVE as of 2026-07-30.** Kevin's subscription is active again and he asked
> for the check on every PR. This skill was DORMANT from 2026-07-25 while the
> trial was lapsed; that pause is over and everything below applies. It runs
> ALONGSIDE codex, not instead of it — see CLAUDE.md §2b for the joint stopping
> rule.

Repo: `D:\march-melee-pools`. qodo.ai reviews PRs on this GitHub repo
(kstruck/MMPoolsV3). Standing authorization from Kevin (2026-07-11, and the
2026-07-30 restore): run this loop WITHOUT asking, then notify with results.

⚠️ **Load this WHEN YOU OPEN THE PR, not when a report lands.** The trigger used
to be "when a qodo report lands on a PR I authored", which is circular — the
watcher that *detects* the report is in §1 of this file, so an agent waiting for a
report before loading the skill never arms the watcher and never performs the
check. A freshly-opened PR has no qodo activity on it by definition. Open the PR
(or mark a draft ready — qodo SKIPS DRAFTS, see §0), then come straight here.

## Track record + the stop rule (calibration)

Across PRs #156-159 (sim harness): **6/6 findings valid**, but severity fell
monotonically each round (prod bug → invariant holes → ordering → response
shape). HANDOFF rule: findings are presumed worth validating, NEVER worth
auto-fixing unverified. If a round's findings are all below
"observable-behavior wrong" (style, hypothetical perf, restating documented
tradeoffs), REJECT with reasons and end the cycle — do not chase the tail.

## The loop

### 0. Posting behavior (observed on PR #162, 2026-07-11)

- qodo SKIPS DRAFT PRs — mark ready-for-review to trigger it (30 min of
  silence on a draft is expected, not slowness).
- It posts a "Qodo is busy working" placeholder issue comment first, then a
  separate PR-summary comment, then the FINDINGS as INLINE review comments
  (`/pulls/<N>/comments`), often with an empty top-level review body.
- It did NOT re-review after a fix push on the same PR (observed once; the
  #157-159 "rounds" were separate PRs).

> ✅ **BILLING RESTORED — 2026-07-30. Wait for the report.**
>
> The 2026-07-22 "DO NOT WAIT AT ALL" override is gone. It applied while the
> trial had lapsed and qodo posted only "Qodo reviews are paused because your
> trial has ended". Kevin's subscription is active again, so the window and the
> background watcher below are **LIVE**, and a single empty pass is **not** a
> clean result.
>
> ⚠️ **Do not count activity — look for a QODO RESULT.** Per the observed
> behaviour directly above, qodo posts a *"Qodo is busy working"* placeholder issue
> comment **first**. A watcher that exits as soon as `comments + reviews > 0`
> therefore stops on the placeholder, before the summary and before the inline
> findings exist, and reports a false clean.
>
> A valid result is any of these, **authored by qodo**: inline findings on
> `/pulls/<N>/comments`, a review with a non-empty body, **or** an issue comment
> that is neither the placeholder nor a billing/paused notice — that last one is
> how a genuine *zero-findings* report arrives, so excluding it would block a PR
> that qodo had actually cleared. The watcher in §1 encodes exactly this; poll on
> all three surfaces, not on the inline endpoint alone.

### 1. Watch for the report

qodo posts to THREE surfaces; check all of them (a report is often review +
inline comments with an empty issue-comment list):

```bash
cd D:/march-melee-pools
gh pr view <N> --json comments,reviews -q '(.comments | length) + (.reviews | length)'
gh api repos/kstruck/MMPoolsV3/pulls/<N>/comments -q 'length'   # inline findings
```

Background watcher — **LIVE again as of 2026-07-30.** (Bash run_in_background;
harness re-invokes on exit; note tool timeout caps ~10 min — re-arm on wake if
still empty):

**Its author login is `qodo-code-review[bot]`** on the REST endpoints and
`qodo-code-review` via `gh pr view` — the `[bot]` suffix is present in one and
absent in the other, which is why the filters below differ. Confirmed empirically
against #231, #235 and #240, the PRs where its findings were valid; do not guess
this from memory.

```bash
QB='qodo-code-review[bot]'    # REST endpoints
QG='qodo-code-review'         # gh pr view
NOISE='busy working|trial has ended|reviews are paused|quota|billing'

# SET THIS IMMEDIATELY BEFORE the push you want reviewed:
#   SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# On the FIRST arming of a new PR, the epoch default is correct.
SINCE="${SINCE:-1970-01-01T00:00:00Z}"

inline() { gh api --paginate repos/kstruck/MMPoolsV3/pulls/<N>/comments \
    -q ".[] | select(.user.login == \"$QB\") | select(.created_at > \"$SINCE\") | .id" | wc -l; }
reviewbody() { gh pr view <N> --json reviews \
    -q ".reviews[] | select(.author.login == \"$QG\") | select(.body != \"\") | select(.submittedAt > \"$SINCE\") | .id" | wc -l; }
summary() { gh pr view <N> --json comments \
    -q ".comments[] | select(.author.login == \"$QG\") | select(.createdAt > \"$SINCE\") | select(.body | test(\"$NOISE\"; \"i\") | not) | .id" | wc -l; }

# PHASE 1 — detect any qodo artifact
SEEN=0
for i in $(seq 1 12); do
  [ "$(inline)" -gt 0 ] || [ "$(reviewbody)" -gt 0 ] || [ "$(summary)" -gt 0 ] && { SEEN=1; break; }
  sleep 45
done
[ "$SEEN" = 1 ] || { echo TIMEOUT; exit 0; }

# PHASE 2 — SETTLE. qodo posts its summary BEFORE its inline findings (§0), so
# exiting on first sight yields a partial report. Two conditions, BOTH required:
#   * a minimum FLOOR of wall-clock since the first artifact, so a slow first
#     finding cannot be mistaken for "no findings"; and
#   * the inline count holding steady across consecutive polls.
FLOOR=180          # seconds; never conclude "0 findings" faster than this
STABLE_NEEDED=4    # consecutive unchanged polls at 30s = 2 min of quiet
START=$SECONDS
PREV=-1; STABLE=0
for i in $(seq 1 30); do
  NOW=$(inline)
  if [ "$NOW" = "$PREV" ]; then STABLE=$((STABLE+1)); else STABLE=0; fi
  PREV=$NOW
  if [ "$STABLE" -ge "$STABLE_NEEDED" ] && [ $((SECONDS-START)) -ge "$FLOOR" ]; then
    echo "QODO REPORTED — $NOW inline finding(s)"; exit 0
  fi
  sleep 30
done
echo "QODO REPORTED — count still moving after settle window, treat as PARTIAL"
```

⚠️ **Six things this watcher's shape is for. Every one of them broke an earlier
draft of this very file — do not "simplify" any of them back out.**

0. **Two phases, because the summary lands BEFORE the findings.** §0 records the
   order: placeholder → summary issue comment → inline findings. A single-phase
   watcher exits the moment the summary appears, so §2 then fetches a report whose
   findings do not exist yet, and the mandatory gate is satisfied by a partial
   review. Phase 1 detects that qodo is posting; phase 2 settles.

   **Settle needs BOTH a time floor and count stability.** Stability alone is not
   enough: an earlier draft used two unchanged polls at 20s, so if qodo's first
   inline finding arrived more than 40 seconds after its summary, all three polls
   saw zero, and the watcher declared a clean review on a PR that was about to
   receive findings. Since the documented order puts findings *after* the summary,
   "0 so far" is the expected reading early on and means nothing. Hence `FLOOR` —
   never conclude zero faster than three minutes — on top of four consecutive
   quiet polls. A genuine zero-findings summary still completes; it just costs
   three minutes of wall-clock to say so, which is the right trade for a gate.

1. **Author, matched EXACTLY.** An earlier version counted *every* inline comment
   and non-empty review body regardless of who wrote them, so a human comment
   landing before qodo finished would fire the watcher and start the absorption
   flow with no qodo result at all. The fix after that used `startswith`, which is
   still too loose — any account named `qodo-code-review-anything` would satisfy
   it. Both logins are known exactly, so both are compared with `==`.
2. **The placeholder vs. a clean report.** qodo posts *"Qodo is busy working"* as
   an issue comment **first**, so a watcher that exits on any activity returns
   seconds in and records a review that never happened. But the opposite
   over-correction is also wrong: ignoring issue comments outright would miss a
   qodo summary that reports **no findings**, which is exactly the clean result
   the stopping rule needs. So issue comments count — with the placeholder
   excluded by content.
3. **A billing failure is NOT a report.** When the trial lapsed in July 2026 qodo
   posted *"Qodo reviews are paused because your trial has ended"* — authored by
   qodo, and not matching "busy working". A filter that only excluded the
   placeholder would count that as a clean review and let the joint gate pass with
   no review at all, which is the exact failure that made the check worthless the
   first time. The content filter therefore also rejects `trial has ended`,
   `reviews are paused`, `quota` and `billing`. **If the only qodo comment on a PR
   is one of those, the check has FAILED, not passed — tell Kevin, because it means
   the subscription needs attention.**
4. **`SINCE`, or a re-arm can never time out.** Re-arming after a fix push
   immediately sees the ORIGINAL summary and findings still sitting on the PR and
   exits `QODO REPORTED` at once — so it can never distinguish a genuine
   re-review from the artifacts of the first one, and the "record a timeout as
   *qodo did not re-review*" instruction below becomes unreachable. Stamp
   `SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)` **before** the push and the watcher
   counts only what arrives after it.
5. **`--paginate`, or findings 31+ vanish.** The REST inline-comment endpoint
   returns 30 per page by default. On a PR that already has 30+ inline comments,
   an unpaginated read misses qodo's findings entirely — and because a qodo
   summary can independently satisfy `C`, the watcher would exit reporting a
   review whose actual findings it never fetched. The full-report step in §2 uses
   `--paginate` for the same reason.

**TIMEOUT is not clean.** If the window expires with nothing, say so explicitly —
"qodo did not report within N minutes" — rather than treating silence as a pass.
Silence and approval look identical, and this repo has been bitten three times by
reading a missing signal as a good one.

### 2. Pull the full report

```bash
gh pr view <N> --json reviews -q '.reviews[] | {author: .author.login, state, body}'
gh api --paginate repos/kstruck/MMPoolsV3/pulls/<N>/comments -q '.[] | {path, line, body}'
gh pr view <N> --json comments -q '.comments[] | {author: .author.login, body}'
```

**`--paginate` on the inline endpoint is load-bearing**, not tidiness: it returns
30 per page, so on a busy PR the unpaginated form silently drops qodo's later
findings and you would absorb a partial report believing it was the whole one.

### 3. Validity call per finding (BEFORE any edit)

For each finding: read the actual code at the cited site; classify —

- **VALID**: reproducible defect or broken invariant → fix.
- **VALID-BUT-DEFERRED**: real, out of the PR's bounded scope → log it in the
  PR reply + (if standing) spawn/note a follow-up; do not scope-creep the PR.
- **INVALID**: cite the line(s) proving why; rejection with evidence goes in
  the notification and (optionally) a PR reply. Never weaken a test or
  assertion to satisfy a finding (clobber-guard rule).

### 4. Fix + gates (every round, no skipping)

One commit per finding-cluster, message crediting the source:
`fix(<area>): <what> (qodo review of PR #<N>)`.

Gates before push — ALL of them, with counts (evidence bar, see
mmp-validation-and-qa):

```powershell
npx tsc -b                              # frontend typecheck
npm --prefix functions run typecheck    # + `npm --prefix functions run build` if functions/tsconfig or index exports changed
npm test                                # root (baseline 244 as of 2026-07-11)
npm --prefix functions test             # functions (baseline 410)
# if functions/emulator surface touched (Java required):
npm --prefix functions run test:emulator   # baseline 83 passed / 10 skipped
# if firestore.rules touched — all six suites:
npx firebase emulators:exec --only firestore --project gridiron-gamble-uzuqo "node functions/scripts/simBackdoors.rules.test.mjs && node functions/scripts/entriesStandings.rules.test.mjs && node functions/scripts/squarePrivate.rules.test.mjs && node functions/scripts/monetization.rules.test.mjs && node functions/scripts/payoutRecords.rules.test.mjs && node functions/scripts/profileAchievements.rules.test.mjs"
```

`git show --stat HEAD` after committing (bad-git-add lesson). Push; CI must
go green (`gh pr checks <N>`).

### 5. Repeat until dry

**Round 2 is back on** (billing restored 2026-07-30) — but read the next
paragraph before you make a clean round 2 a *requirement*.

⚠️ **DO NOT gate on a second qodo pass. It may never come.** The observed-behaviour
list above records that qodo **did not re-review after a fix push on the same
PR** — the #157–159 "rounds" were separate PRs. So a stopping rule of the form
"keep going until a fresh qodo round is clean" can be **unsatisfiable**: you fix
its finding, re-arm, and the watcher simply times out. That would deadlock the
joint gate in CLAUDE.md §2b on every PR where qodo actually finds something,
which is precisely the PRs that matter most.

**What "qodo is clean" means for the §2b stopping rule:**

> qodo has **REPORTED**, and every finding it raised is either fixed or rejected
> with written reasoning on the PR.

That is the bar — a per-finding resolution, not a fresh empty pass. qodo marks
absorbed findings `✓ Resolved`, and that mark is the confirmation. If it *does*
re-review on your push, treat a clean result as corroboration and a new finding
as a new round; just never *wait* on one.

The observation is from a single PR, so it may not hold universally. Re-arm the
watcher if you like — it costs nothing but wall-clock — but record TIMEOUT as
"qodo did not re-review", never as "qodo is clean".

Cycle ends when: every finding is fixed or rejected with reasoning, OR every
remaining one is INVALID / below the severity stop rule, OR 5 rounds (MAX_ROUNDS
convention) — whichever first. Deadlock ≠ silence: if stopping with open disputed
findings, say so.

🛑 **FIXING A QODO FINDING RE-OPENS THE CODEX GATE. Re-run codex on the final
diff before you call the joint gate satisfied.**

The codex pass happens BEFORE the PR is opened; qodo reviews the PR after. So any
code written to close a qodo finding is code codex has **never seen**, and
stopping on "qodo marked it ✓ Resolved" would ship it reviewed by exactly one
model. CLAUDE.md §2c is explicit that new code written to close a finding earns
its own round — that rule does not stop applying because the finding came from the
other reviewer.

This is not hypothetical on this repo: on 2026-07-30, rounds 2, 4 and 5 of #322
each found a defect **in the previous round's fix**, and this very file went seven
codex rounds where every round after the first holed the fix before it.

So the joint gate closes only when: **qodo's findings are all resolved AND a codex
round on the FINAL diff is clean AND your own read agrees.** If the qodo fix was a
one-word doc change and you judge a re-run wasteful, that is a defensible call —
but say so explicitly in the PR body rather than leaving it unstated.

### 6. Notify Kevin

One message: per-finding table (finding → verdict VALID/INVALID/DEFERRED →
action + commit SHA), gate evidence with counts, rounds consumed, and whether
the PR is ready to merge. No "done" without the counts.

## Boundaries

- This loop NEVER merges the PR, deploys, or flips kill-switches — those stay
  Kevin's (mmp-change-control §6).
- Scope stays inside the PR's plan phase; new work qodo suggests goes to the
  deferred list, not the diff.
- If qodo flags something in code the PR didn't touch, treat as VALID-BUT-
  DEFERRED by default.
