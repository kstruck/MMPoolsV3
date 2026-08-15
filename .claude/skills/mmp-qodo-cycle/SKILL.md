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
# STAY IN THE PR's WORKTREE. Do NOT cd to D:/march-melee-pools.
# Paginated REST on all three — same reason as the watcher (see note 5 below).
R=repos/kstruck/MMPoolsV3
gh api --paginate $R/issues/<N>/comments -q 'length'   # summary / zero-findings report
gh api --paginate $R/pulls/<N>/comments  -q 'length'   # inline findings
gh api --paginate $R/pulls/<N>/reviews   -q 'length'   # review-surface report
```

**These are a quick eyeball only — prefer arming the watcher below.** They are
deliberately paginated REST rather than `gh pr view --json`: this example block
used the GraphQL form and an unpaginated inline query, which the rest of this
skill spends two notes explaining can return 0 after qodo has posted. *(qodo's own
finding on PR #326 — the first PR reviewed under the restored rule. Ten codex
rounds fixed the watcher and §2 and missed this block.)*

🛑 **This block used to start `cd D:/march-melee-pools`, and that was a real
hazard.** PRs are made from a worktree (Rule 4), nothing in §§2–4 changes the
directory back, and every one of those steps writes: you read the cited code, run
the gates, commit and push the fix, and re-run codex. After that `cd` they would
all run against the **primary checkout on `main`** instead of the PR branch. The
`gh` commands take `<N>` and need no particular directory — they work fine from
the worktree. This repo already has a clobber incident from cross-worktree
confusion (PR #116/#117, see `mmp-change-control`); do not reintroduce the shape
of it.

Background watcher — **LIVE again as of 2026-07-30.** (Bash run_in_background;
harness re-invokes on exit; the tool caps a run at roughly 10 minutes.)

**If it wakes still empty, re-arm it unchanged.** **If it wakes mid-settle — i.e.
it printed nothing but qodo HAS posted — re-arm with the SAME `SINCE` and skip
straight to phase 2**; do not treat the interruption as a timeout and do not
restart the floor from a fresh detect. The phases below are sized to fit one
10-minute run (4 min detect + ~5 min settle), so this should be rare rather than
routine.

**Its author login is `qodo-code-review[bot]`** on the REST endpoints and
`qodo-code-review` via `gh pr view` — the `[bot]` suffix is present in one and
absent in the other. Confirmed empirically against #231, #235 and #240, the PRs
where its findings were valid; do not guess this from memory. The watcher below
is entirely REST, so it only needs the `[bot]` form; the `gh pr view` form still
matters if you filter output from §2's review query.

```bash
QB='qodo-code-review[bot]'    # REST — the watcher is all REST, so this is the only one it needs
# Matched against the comment's HEADING (first ~120 chars), never the whole body.
NOISE='Qodo is busy working|trial has ended|reviews are paused|exceeded your'

# SET THIS IMMEDIATELY BEFORE the push you want reviewed. Note the '1 second ago':
#   SINCE=$(date -u -d '1 second ago' +%Y-%m-%dT%H:%M:%SZ)
# GitHub timestamps are whole seconds and the comparisons below are strict '>', so
# a stamp taken in the SAME second qodo posts would EXCLUDE that artifact and the
# watcher would report a false TIMEOUT — blocking the gate on a PR that was
# reviewed. Backing off one second errs the other way: at worst one pre-push
# artifact is counted, which phase 2's settle and your own validity pass both
# catch. A false timeout is the more expensive mistake. (qodo's finding on #326.)
# On the FIRST arming of a new PR, the epoch default is correct.
SINCE="${SINCE:-1970-01-01T00:00:00Z}"

# ALL THREE on paginated REST. `gh pr view --json` is GraphQL and returns only
# the first page, so on a busy PR a qodo summary or review body past that cap is
# invisible and every predicate stays 0 while qodo has in fact reported.
R="repos/kstruck/MMPoolsV3"

# FAIL CLOSED. Piping `gh api` straight into `wc -l` discards its exit status --
# `wc` succeeds on empty input -- so a transient API failure became "0 findings",
# and phase 2 could settle at zero and emit QODO REPORTED without ever having
# read the comments. That verdict UNLOCKS the gate, so a network blip would
# certify an unread review. Silence read as success is this repo's single most
# repeated defect (#314's unbound token, the zero-counter heartbeat, the 13-day
# Sentry outage). Each helper echoes ERR on failure; `guard` makes any ERR fatal.
_count() { local out; out=$(gh api --paginate "$@") || { echo ERR; return; }; printf '%s\n' "$out" | grep -c . ; }
guard() { case "$*" in *ERR*) echo "QODO WATCH FAILED -- API error, verdict UNKNOWN. Do NOT treat as clean."; exit 1;; esac; }

inline() { _count $R/pulls/<N>/comments \
    -q ".[] | select(.user.login == \"$QB\") | select(.created_at > \"$SINCE\") | .id"; }
reviewbody() { _count $R/pulls/<N>/reviews \
    -q ".[] | select(.user.login == \"$QB\") | select(.body != \"\") | select(.submitted_at > \"$SINCE\") | .id"; }
# NOISE matches the <h3> HEADING ONLY, not the first 200 body characters. qodo's
# real report opens `<h3>PR Summary by Qodo</h3>`; a body-prefix match discards
# that genuine report whenever the PR is ABOUT billing or paused reviews -- and
# this PR is about exactly that. Anchor on the heading and the content cannot
# eat its own report.
summary() { _count $R/issues/<N>/comments \
    -q ".[] | select(.user.login == \"$QB\") | select(.created_at > \"$SINCE\") | select((.body | capture(\"<h3>(?<h>[^<]*)</h3>\").h // \"\") | test(\"$NOISE\"; \"i\") | not) | .id"; }
# THE REVIEW ITSELF. qodo posts TWO substantive issue comments, in this order and
# far apart: `<h3>PR Summary by Qodo</h3>` first, `<h3>Code Review by Qodo</h3>`
# later — and the inline findings land in the SAME SECOND as the Code Review
# comment, never with the summary. MEASURED ON #432, 2026-08-14: summary 19:12:57Z,
# Code Review 19:29:28Z, first inline finding 19:29:30Z. SIXTEEN AND A HALF
# MINUTES. So the summary is a precursor, not a review, and phase 2 must not
# conclude until this comment (or a review-surface report) exists.
codereview() { _count $R/issues/<N>/comments \
    -q ".[] | select(.user.login == \"$QB\") | select((.updated_at // .created_at) > \"$SINCE\") | select((.body | capture(\"<h3>(?<h>[^<]*)</h3>\").h // \"\") | test(\"Code Review by Qodo\"; \"i\")) | .id"; }

# PHASE 1 — detect any qodo artifact. Deliberately 4 min, NOT 9: the settle phase
# below needs its 180s floor plus quiet polls, and the background tool is capped
# around 10 minutes. A 9-minute detect phase leaves no room to settle and the
# watcher gets killed after qodo has posted but before it reports.
SEEN=0
for i in $(seq 1 8); do
  I=$(inline); RB=$(reviewbody); S=$(summary); guard "$I" "$RB" "$S"
  [ "$I" -gt 0 ] || [ "$RB" -gt 0 ] || [ "$S" -gt 0 ] && { SEEN=1; break; }
  sleep 30
done
[ "$SEEN" = 1 ] || { echo TIMEOUT; exit 0; }

# PHASE 2 — SETTLE. qodo posts its summary BEFORE its inline findings (§0), so
# exiting on first sight yields a partial report. Two conditions, BOTH required:
#   * a minimum FLOOR of wall-clock since the first artifact, so a slow first
#     finding cannot be mistaken for "no findings"; and
#   * the inline count holding steady across consecutive polls.
# ⚠️ MEASURED ON #348, 2026-08-03: the summary landed 04:20:15Z and the inline
# findings 04:26:37Z — SIX MINUTES AND TWENTY SECONDS later. At FLOOR=180 the
# watcher printed "QODO REPORTED — 0 inline finding(s)" and the session reported
# a clean qodo pass on a PR that was about to receive two findings, one of them a
# real correctness bug. Both settle conditions were satisfied and both were
# wrong: quiet is what the gap between the two posts LOOKS like.
# The floor now exceeds that observed gap. Raise it again if a longer one is ever
# measured; do not lower it because a run felt slow.
# ⚠️ AND THEN #432 (2026-08-14) MEASURED A 16.5-MINUTE GAP, which no floor
# anchored on the summary survives. So the ANCHOR moved (FIRST, below): the floor
# is now measured from the `Code Review by Qodo` comment, not from the summary,
# and phase 2 refuses to conclude before that comment exists. The 480s value is
# kept as quiet-since-the-review; it is not the thing that saved #432 — the anchor
# and the third exit condition are.
FLOOR=480          # seconds; never conclude "0 findings" faster than this
STABLE_NEEDED=4    # consecutive unchanged polls at 30s = 2 min of quiet

# THE FLOOR IS MEASURED FROM QODO'S FIRST POST, NOT FROM THIS PROCESS START.
# It has to be, now that it exceeds one run: the settle loop below is 5 minutes
# and the whole background run is capped near 10, so a floor of 8 minutes could
# never be satisfied inside a single arming and every run would print PARTIAL
# forever. Anchoring on the artifact's own timestamp makes the floor survive a
# re-arm — run 1 prints PARTIAL, run 2 starts with the clock already ~5 minutes
# in and can legitimately settle. It is also the more correct clock: what matters
# is how long qodo has been quiet, not how long this shell has been awake.
# FILTERED BY $SINCE, and covering ALL THREE surfaces. Both halves are load-bearing:
#
#   * WITHOUT the $SINCE filter, a re-arm on a PR that already carries an OLD qodo
#     artifact anchors the floor to that historical timestamp. elapsed() is then
#     already past 480s on the first poll, four quiet polls emit QODO REPORTED,
#     and the delayed inline findings of the CURRENT review land afterwards —
#     which is precisely the false-clear this floor was raised to prevent,
#     reintroduced through the re-review path (the toggle in CLAUDE.md §2b).
#   * WITHOUT the reviews endpoint, a report that arrives ONLY as a review body —
#     a valid result per phase 1 — leaves FIRST empty, every arming falls back to
#     a fresh process clock, and the watcher returns PARTIAL forever.
#
# ⚠️ ANCHORED ON THE `Code Review by Qodo` COMMENT, NOT ON THE FIRST ARTIFACT.
# (Changed 2026-08-15 after #432.) The previous anchor was "earliest across all
# three surfaces", which on every PR is the `PR Summary by Qodo` comment. On #432
# that summary landed 16.5 minutes before the Code Review comment and its inline
# findings (measured above at codereview()). FLOOR=480 elapsed with the inline
# count sitting at a stable zero, and the watcher printed
# `QODO REPORTED — 0 inline finding(s)` TWICE while seven findings were still in
# flight. Both settle conditions held and both were wrong — the same failure
# #348 taught, one artifact further down the chain. Anchoring on the review
# comment makes the floor measure quiet-since-the-REVIEW, which is the only
# clock that means anything, and phase 2 below additionally refuses to conclude
# before that comment exists at all.
#   * The `PR Summary` comment and the `pulls/<N>/comments` leg are DELIBERATELY
#     absent from this anchor. The summary is a precursor; the inline comments
#     arrive with the review and never before it, so they add nothing.
#   * The reviews leg stays: a report that arrives ONLY as a review body is a
#     valid result per phase 1, and without it FIRST would be empty on that path
#     and the watcher would return PARTIAL forever.
#   * ON `updated_at`, NOT `created_at`, FOR COMMENTS. qodo edits its review
#     comment IN PLACE on the toggle re-review path (§ re-arm, measured on #346),
#     so created_at does not move. A created_at anchor is empty on exactly that
#     path — phase 1 detects the re-review, FIRST does not, the process-clock
#     fallback cannot reach the floor in one arming, and the watcher returns
#     PARTIAL forever on a PR qodo has just re-reviewed. `.updated_at // .created_at`
#     is correct on BOTH paths (they are equal on a fresh comment), so there is one
#     expression to keep in sync rather than a first-review and a re-review variant.
FIRST=$( { gh api --paginate $R/issues/<N>/comments \
      -q ".[] | select(.user.login == \"$QB\") | select((.updated_at // .created_at) > \"$SINCE\") | select((.body | capture(\"<h3>(?<h>[^<]*)</h3>\").h // \"\") | test(\"Code Review by Qodo\"; \"i\")) | (.updated_at // .created_at)";
    gh api --paginate $R/pulls/<N>/reviews \
      -q ".[] | select(.user.login == \"$QB\") | select(.body != \"\") | select(.submitted_at > \"$SINCE\") | .submitted_at";
  } | sort | head -1)
# No parseable first artifact -> fall back to this process's clock. Never treat
# an unparseable timestamp as "floor already met"; that is the failure the floor
# exists to stop. On that fallback a single 5-minute arming CANNOT reach an
# 8-minute floor, so the run prints PARTIAL and re-arming prints PARTIAL again.
# That is fail-CLOSED and correct — a repeating PARTIAL means "the timestamp
# fetch is broken, fix it", never "qodo is clean, proceed".
FIRST_EPOCH=$(date -u -d "$FIRST" +%s 2>/dev/null || echo "")
elapsed() {
  if [ -n "$FIRST_EPOCH" ]; then echo $(( $(date -u +%s) - FIRST_EPOCH ));
  else echo $((SECONDS - START)); fi
}
START=$SECONDS
PREV=-1; STABLE=0
# 10 polls x 30s = 5 min per arming. NOT 30 (=15 min): a 15-min settle put the
# worst case past the ~10-min background-tool cap, so the tool was killed before
# it could print the PARTIAL line below and the branch was unreachable. Multiple
# armings are how the 8-minute floor is reached; that is what `elapsed()` is for.
# THIRD CONDITION (2026-08-15, #432): the review itself must exist. Until the
# `Code Review by Qodo` comment (or a review-surface report) is present, a stable
# inline count of zero is the gap between summary and review, not a verdict.
# Without this line a fresh arming that starts before the review lands would fall
# back to the process clock, and — with the summary already posted — could still
# reach the floor and settle at zero. Belt to the anchor's braces.
for i in $(seq 1 10); do
  NOW=$(inline); CR=$(codereview); RB=$(reviewbody); guard "$NOW" "$CR" "$RB"
  if [ "$NOW" = "$PREV" ]; then STABLE=$((STABLE+1)); else STABLE=0; fi
  PREV=$NOW
  if [ "$STABLE" -ge "$STABLE_NEEDED" ] && [ "$(elapsed)" -ge "$FLOOR" ] && [ $((CR + RB)) -gt 0 ]; then
    echo "QODO REPORTED — $NOW inline finding(s)"; exit 0
  fi
  sleep 30
done
echo "QODO PARTIAL — count still moving, or the Code Review comment has not landed yet; DO NOT run the joint gate on this set. Re-arm and settle again before absorbing."
```

⚠️ **`QODO PARTIAL` IS NOT A PASS.** The watcher has exactly two success
verdicts and only ONE of them may feed §2: `QODO REPORTED` means the count
settled and the report is complete; `QODO PARTIAL` means qodo was still posting
when the window closed. Absorbing a PARTIAL set satisfies the joint gate against
findings qodo had not finished writing — the gate then certifies a review that
never completed, which is worse than no gate. On PARTIAL: re-arm (§ re-arm
command, with its one-second backoff) and settle again; only `QODO REPORTED`
unlocks the absorption flow.

This mattered only once the settle window was bounded to fit the runtime cap
(codex r11) — before that the tool was killed before it could print PARTIAL at
all, so the branch was unreachable and the hazard was hidden rather than absent.

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
3b. **Match the HEADING, not the body — found by RUNNING this, not by review.**
   The first real use of this watcher (PR #326) reported zero while qodo had
   already posted its summary. Cause: the noise list contained the bare words
   `quota` and `billing`, and qodo's *"PR Summary by Qodo"* comment for that PR
   quoted the word "billing" — because the PR was **about** billing. A content
   filter over the whole body therefore discards a genuine report whenever the PR
   happens to discuss the same subject as the failure notices.

   The distinguishing signal is the `<h3>` heading, which is the first thing in
   every qodo comment. `summary()` therefore EXTRACTS that heading with
   `capture("<h3>(?<h>[^<]*)</h3>")` and tests `NOISE` against **the heading
   alone** — not `.body[0:200]`, and not the whole body. An earlier draft used the
   200-character prefix, which is still a content filter and still eats a real
   report whenever the prose near the top happens to discuss the same subject.
   `NOISE` is correspondingly specific phrases, not bare words:
   `Qodo is busy working|trial has ended|reviews are paused|exceeded your` — note
   it deliberately does NOT contain `billing` or `quota`.

   Verified against #326's real comments through `gh`'s jq engine: the headings
   present are `Qodo is busy working`, `PR Summary by Qodo` and
   `Code Review by Qodo`, so the placeholder is excluded and both real artifacts
   are counted.

   Generalise it: **a filter keyed on words that can legitimately appear in the
   content it is filtering will eventually eat a real result.** Anchor to
   structure.

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
   `SINCE=$(date -u -d '1 second ago' +%Y-%m-%dT%H:%M:%SZ)` **before** the push
   and the watcher counts only what arrives after it. ⚠️ Use the SAME one-second
   backoff as §1, not a bare `date -u`: the predicates compare with strict `>`
   and GitHub timestamps are whole seconds, so a stamp taken in the second qodo
   posts EXCLUDES that artifact and the gate reports `TIMEOUT` on a PR qodo did
   review. That is the identical boundary race qodo itself found in the first
   version of this file — do not reintroduce it on the re-arm path.
5. **Paginated REST on ALL THREE surfaces.** Two separate holes, the second
   introduced by the fix for the first. (i) The REST inline-comment endpoint
   returns 30 per page, so on a PR with 30+ inline comments an unpaginated read
   misses qodo's findings entirely — and since a summary independently satisfies
   the predicate, the watcher would exit reporting a review whose findings it
   never fetched. (ii) That fix then used `gh pr view --json` for the other two
   surfaces, which is **GraphQL and also returns only a first page**: a qodo
   summary or review body beyond that cap leaves every predicate at 0 while qodo
   has in fact reported, so the check times out on a PR that WAS reviewed. All
   three surfaces now use `gh api --paginate`, which has the side benefit of one
   author constant (`$QB`) rather than two. §2 paginates for the same reason.

**TIMEOUT is not clean.** If the window expires with nothing, say so explicitly —
"qodo did not report within N minutes" — rather than treating silence as a pass.
Silence and approval look identical, and this repo has been bitten three times by
reading a missing signal as a good one.

### 2. Pull the full report

```bash
R=repos/kstruck/MMPoolsV3
gh api --paginate $R/pulls/<N>/reviews   -q '.[] | {author: .user.login, state, body}'
gh api --paginate $R/pulls/<N>/comments  -q '.[] | {author: .user.login, path, line, body}'
gh api --paginate $R/issues/<N>/comments -q '.[] | {author: .user.login, body}'
```

**All three are paginated REST, matching the watcher.** Two of them were
`gh pr view --json`, which is GraphQL and returns a first page only — so on a PR
with more than a page of reviews or issue comments this step would omit the very
report the paginated watcher had just detected, and the validity pass would close
the gate having never seen it.

**Keep the author on every line, and validity-call only qodo's.** The inline
command used to project `{path, line, body}` with no author, so on a PR that also
has human review comments the per-finding pass in §3 could not tell them apart —
and would absorb or reject a colleague's comment as though qodo had written it,
while the watcher had counted only `qodo-code-review[bot]`. If you want just
qodo's, add `| select(.user.login == "qodo-code-review[bot]")`.

**`--paginate` on the inline endpoint is load-bearing**, not tidiness: it returns
30 per page, so on a busy PR the unpaginated form silently drops qodo's later
findings and you would absorb a partial report believing it was the whole one.

### 3. Validity call per finding (BEFORE any edit)

For each finding: read the actual code at the cited site; classify —

- **VALID**: reproducible defect or broken invariant → fix.
- **VALID-BUT-DEFERRED**: real, out of the PR's bounded scope → log it in the
  PR reply + (if standing) spawn/note a follow-up; do not scope-creep the PR.
- **INVALID**: cite the line(s) proving why. **The rejection, with its evidence,
  MUST be written on the PR** — not only in the run notification. ⚠️ This used to
  say a PR reply was *optional*, which contradicted the completion condition
  below ("every finding is either fixed or rejected with written reasoning on the
  PR") and let the loop mark a PR clean with no audit trail for exactly the
  findings a human would most want to second-guess. A rejection nobody can read
  is indistinguishable from a finding that was ignored. Never weaken a test or
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

### ✅ 2026-08-02 — you CAN make it re-review: toggle draft → ready

**Measured three times in one session, on #338, #345 and #343.** A push — force
push or ordinary — produced **no** re-review. Two of those PRs sat silent for
20+ minutes. Then:

⚠️ **Move `SINCE` FORWARD before the toggle, not after.** Reuse the `SINCE` from
an earlier arm and the watcher's `select(.created_at > $SINCE)` still admits the
PRE-FIX artifacts — so it prints `QODO REPORTED` the instant it starts and hands
you the OLD review as if it were the fresh one. That is this section's failure
mode wearing a success message.

The §1 watcher needs no change: it is timestamp-driven, so setting `SINCE` to now
is the whole fix. Order is **`SINCE` → toggle → arm**:

```bash
SINCE=$(date -u -d '1 second ago' +%Y-%m-%dT%H:%M:%SZ)   # backoff, as on re-arm
gh pr ready <N> --undo    # → draft
gh pr ready <N>           # → ready for review
# now arm the §1 watcher unchanged, with that SINCE
```

⚠️ **Do NOT reach for a count-based baseline instead.** The obvious version —
`gh api --paginate ... --jq '[...] | length'` — is broken: with `--paginate`,
`--jq` runs **per page**, so it emits one count per page. Measured on #338 with
`per_page=1`: `1 1 0 0 0 1 0` instead of `3`. That feeds `1
1
0...` into shell
arithmetic and fails on exactly the multi-page PRs CLAUDE.md §2b insists on
paginating. `_count` above avoids it by selecting `.id` and piping to `grep -c .`;
any new counter must do the same.

qodo posted a fresh review **within 90 seconds** every time, stamped at the
current head commit, with its resolved findings marked `✓ Resolved`.

🔴 **AND IT UPDATES THE EXISTING COMMENT IN PLACE — `created_at` DOES NOT MOVE.**
Measured on #346: the re-review arrived as `updated_at 09:11:55Z` on a comment
whose `created_at` was `08:35:48Z`. A watcher filtering `select(.created_at >
$SINCE)` therefore sees **nothing** and reports TIMEOUT on a PR qodo has just
re-reviewed — the same false-negative the `$SINCE` rule exists to prevent, from
the opposite direction.

So on the TOGGLE path, filter on **`updated_at`** (`submitted_at` for the reviews
endpoint has no in-place equivalent, so it stays as is):

Redefine §1's `summary()` — do NOT hand-roll it. The obvious one-liner drops two
protections the helper already has: the `NOISE` heading filter (so the
`Qodo is busy working` placeholder is counted as the re-review) and
`_count`/`guard`'s fail-CLOSED behaviour (a bare `gh api | grep -c` reports an
API failure as `0`, i.e. silence read as "nothing yet").

```bash
# TOGGLE PATH: identical to §1's summary() except updated_at replaces created_at.
summary() { _count $R/issues/<N>/comments \
    -q ".[] | select(.user.login == \"$QB\") | select(.updated_at > \"$SINCE\") | select((.body | capture(\"<h3>(?<h>[^<]*)</h3>\").h // \"\") | test(\"$NOISE\"; \"i\") | not) | .id"; }
# inline() keeps created_at: PR review comments are posted, not revised in place.
```

and keep the `guard "$I" "$RB" "$S"` calls exactly as §1 has them.

Two more things that pass measured on #346 and will bite a naive watcher:
 - qodo posts a **`Qodo is busy working`** placeholder FIRST. Counting it as an
   artifact settles the watcher on an empty review — the `NOISE` heading filter
   in §1 exists for this; do not drop it from an ad-hoc watcher.
 - the real report then lands, and can be REVISED again minutes later. On #346
   the first body said `Bugs (0)` and the revision said `Bugs (3)` with four new
   findings. **Settle on `updated_at` holding steady, not on first sight.**

This follows from the trigger already recorded at the top of this file — qodo
SKIPS DRAFT PRs, so marking one ready is what fires it — but the consequence had
not been drawn: **the same transition re-fires it on a PR that is already open.**

**Why this matters more than convenience.** #338 was rebased onto a new `main`
and gained a substantial new change (the §4a canonical filter). Without a
re-review, the only qodo evidence available was a report on the *pre-rebase*
diff, and merging on it would have meant calling the mandatory gate satisfied
using a review of code that was no longer in the PR. The toggle turned an
unsatisfiable gate into a satisfied one.

⚠️ **This does not soften the rule above.** Do the toggle, watch, and if it still
does not report, that is still a TIMEOUT and still "qodo did not re-review" —
never "clean". The per-finding resolution bar is unchanged. What changed is that
you should now *try* the toggle before recording a timeout, because a timeout you
could have avoided is a weaker gate for no reason.

⚠️ **Draft state is visible to anyone watching the PR**, and a PR in draft cannot
be merged. Toggle it back immediately — both commands in one step, as above.

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
