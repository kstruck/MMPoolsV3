# RUNBOOK — taking `kstruck/MMPoolsV3` private

**Status: PREP ONLY. NOT EXECUTED.** Written 2026-08-28 at Kevin's request:
*"Time to take the Git repo private. Make a checklist for me to ensure that
doing so will not affect my workflow in Claude and in Coolify."*

Everything here is written so the flip can be executed deliberately, once, by
the owner. The visibility change itself is **two clicks and instantly
reversible** — the work is entirely in the four things that quietly change
around it.

**Change-control classification:** adding this document is docs-only and
triggers no gate (`mmp-change-control` §1 — no money, no authorization, no
production data, no scoring). *Executing* it touches repository access control
and the production deploy path, which is why it is a runbook with a rollback
step rather than a paragraph.

---

## 0. The short version

Four things change. Three of them are silent.

| # | What | Today (public) | After the flip | Silent? |
|---|---|---|---|---|
| 1 | **Coolify's git clone** | Works — anonymous clone if the source is a *Public Repository* | **Fails** if the source type is *Public Repository*. Fine if it is a GitHub App or Deploy Key | ❌ Loud — the build fails |
| 2 | **Actions minutes** | Free and unlimited | Metered. **~24,000–26,000 min/month measured** against a 2,000-min allowance | ✅ Silent until CI stops dead |
| 3 | **Required-status-check ruleset** | Enforced | **Stops being enforced on GitHub Free.** Needs Pro or higher for private repos | ✅ Silent — PRs just start merging without CI |
| 4 | **Secret scanning + push protection** | Free | Gone (needs paid GitHub Secret Protection) | ✅ Silent |

**Everything else is fine**, including the parts most likely to worry you — see
§6. In particular: **Coolify never pushes to GitHub.** It only clones. There is
no "Coolify can't push its changes" failure mode to avoid, because Coolify has
nothing to push.

---

## 1. 🛑 DECISIONS — answer these three before touching anything

### D1 — GitHub plan: stay on Free, or upgrade to Pro?

**The problem.** GitHub rulesets and classic branch protection are available on
**public** repositories on Free, and on **public and private** repositories only
on Pro, Team, and Enterprise Cloud. `.github/workflows/ci.yml` documents a
main-scoped ruleset (id `11714546`) requiring four contexts: `build-and-test`,
`emulator-tests`, `security-audit`, `nginx-validate`.

On Free, going private stops that ruleset being enforced. Nothing announces it.
The next PR merges green-or-not.

To be precise about what is lost: CLAUDE.md §2e is a list of seven **local**
commands and was always operator discipline, never machine-enforced. What lapses
here is the narrower, harder thing — the four CI contexts that mechanically block
a red merge. That is the only automated gate on `main`, and it goes quiet.

**Recommendation: upgrade to GitHub Pro before flipping.** It is a few dollars a
month and it is the only thing standing between this repo and un-gated merges to
`main`.

### D2 — Coolify git source: GitHub App, or Deploy Key?

Only relevant if §2 / step A1 finds the source type is *Public Repository*.

| | GitHub App | Deploy Key |
|---|---|---|
| Setup | Install Coolify's GitHub App on the `kstruck` account | Coolify generates an SSH key; you add it under repo Settings → Deploy keys |
| Auto webhooks | Yes (Coolify configures them) | No |
| Preview deploys | Yes | No |
| Scope | Whichever repos you select | Exactly this one repo, read-only |

**Recommendation: Deploy Key.** The frontend deploy is a **manual trigger by
design** (CLAUDE.md §3 — "pushing to `main` does **not** auto-deploy the
frontend"), so the GitHub App's headline features — automatic webhooks and
preview deploys — buy nothing here, and the App's webhook is a way to
*accidentally* turn on auto-deploy. A read-only deploy key is the smaller blast
radius and matches how you actually operate.

### D3 — Actions spend: pay the overage, self-host runners, or stay public?

**Measured, not estimated** (full working in §8): **19–21 billable minutes per push
or PR event**, at **~42 events/day** → **~800–880 min/day ≈ 24,000–26,000
min/month**.

- GitHub Free includes **2,000** Actions minutes/month for private repos. At the
  current rate that is exhausted in **~2.3 days**.
- 🛑 **The default spending limit on Free is $0.** So CI does not bill you — it
  **stops running**, about 55 hours into every month, and stays stopped. That is
  the failure mode to plan for, not a surprise invoice.
- If you raise the limit: the overage is roughly **22,000–24,000 min × ~$0.006/min
  ≈ $130–145/month**. Confirm the current Linux 2-core rate on your own billing
  page before treating that as the number.

**No realistic CI trim fits this into 2,000 minutes.** Dropping the `push:`
trigger saves 33% of runs; gating `e2e-playwright` (11 of `ci.yml`'s 19 minutes —
**~55% of the bill**) saves about half again. Both together still land near 8,000
min/month. The activity level, not the workflow design, is what does not fit.

**Recommendation: register a self-hosted Actions runner on the Coolify host.**
Self-hosted runner minutes are free for private repositories, GitHub's announced
per-minute self-hosted platform charge was **postponed** (2025-12-15), and you
already own and run the hardware. Second choice: raise the spending limit and
accept ~$145/month. Third: leave the repo public.

⚠️ A self-hosted runner on a private repo is safe here (no forks, no outside
contributors — see §6). Never do it on a public repo.

### Sourcing note for D1 and D3

Four claims above come from GitHub's own published docs and pricing pages, checked
**2026-08-28**, and cannot be verified from inside this repository:

1. Rulesets and branch protection cover public repos on Free, but private repos
   only on Pro / Team / Enterprise Cloud.
2. GitHub Free includes 2,000 Actions minutes/month for private repositories.
3. GitHub reduced hosted-runner prices effective 2026-01-01; the Linux 2-core rate
   used here is ~$0.006/min.
4. The announced per-minute charge for **self-hosted** runners was postponed
   (announced 2025-12-15), so self-hosted minutes are currently free.

Billing terms change. **Re-confirm 1 and 4 before acting on D1 and D3** — they are
the two the recommendations actually rest on — and read 2 and 3 off your own
billing page rather than off this page.

---

## 2. PART A — pre-flight, done while the repo is still PUBLIC

Do **all** of Part A before Part B. Every step here is reversible and none of it
requires the repo to be private, which is exactly why it goes first: you get to
find the breakage while the safety net is still up.

### A1 — Determine how Coolify actually clones this repo

**This is the single most important step in the runbook.** It decides whether
the flip is a non-event or breaks your deploys.

1. Open the Coolify dashboard → the **www / March Melee Pools** application →
   **Configuration → Source**.
2. Read what it says:

| What you see | Meaning | Action |
|---|---|---|
| **Public Repository** + a URL like `https://github.com/kstruck/MMPoolsV3` | Anonymous HTTPS clone | 🛑 **WILL BREAK.** Do A2 + A3 |
| **Private Repository (with GitHub App)** | Authenticated via a Coolify GitHub App | ✅ Safe. Skip to A4 |
| **Private Repository (with Deploy Key)** | Authenticated via SSH deploy key | ✅ Safe. Skip to A4 |

3. Cross-check from the GitHub side — these two pages tell you the same thing
   independently, and are worth reading even if the Coolify screen looked clear:
   - <https://github.com/kstruck/MMPoolsV3/settings/keys> — a deploy key here
     means Coolify (or something) is already using the key path.
   - <https://github.com/settings/installations> — a Coolify installation here
     means the GitHub App path is available.

**Not derivable from this repository — I checked.** `README.md` §Deployment Guide
describes creating the resource without naming the source type, and no other file
records it. (The `mmp-deploy-and-operate` skill does carry an explicit unknown for
"Coolify deploy mode", but that one is about *trigger* mode — manual vs auto — not
about the git source type, so it is not evidence either way here.) You have to go
and look.

### A2 — Back up the Coolify environment BEFORE changing anything

Coolify selects an application's source type **when the resource is created**.
If your version offers no way to change it under Configuration → Source, the
migration in A3 means creating a **new** application — and a new application
starts with **no environment variables**. Losing them silently ships a broken
bundle, because Vite inlines these at build time.

Screenshot or copy out every variable, **and note which are flagged as build
variables** (Coolify passes only those as `--build-arg`; a variable set but not
flagged never reaches `npx vite build`, and the code that reads it becomes dead
in the image).

`Dockerfile` declares exactly these build args — this is the authoritative list:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_SENTRY_DSN                     (optional — empty means Sentry off)
VITE_SENTRY_REPLAY_SAMPLE_RATE      (optional)
```

⛔ **Do NOT add `VITE_RECAPTCHA_SITE_KEY`.** Setting it in the Coolify
environment preceded the 2026-07-30 total-outage (permanent spinner, no data, no
error); deleting it restored service. The mechanism is still **unexplained** —
see `RUNBOOK-SITE-DOWN.md` step 2a. Treat it as a live landmine, not a fixed bug.

✅ **Check two values recorded as malformed** while you are in here.
`PHASE0-DEPLOY-CHECKLIST.md` step 6 lists both as **unchecked boxes**, and
`mmp-deploy-and-operate` marks the fix **UNVERIFIED** ("owner interview didn't
confirm completion"). So these may already be fixed — read them before editing,
and do not assume the state below is current:
- `VITE_FIREBASE_STORAGE_BUCKET` was recorded as the literal string
  `"VITE_FIREBASE_MESSAGING_SENDER_ID=1042141442549"`. It should be the real
  bucket, e.g. `gridiron-gamble-uzuqo.appspot.com`.
- `VITE_FIREBASE_AUTH_DOMAIN` was recorded as doubled
  (`…firebaseapp.com=…firebaseapp.com`). It should be
  `gridiron-gamble-uzuqo.firebaseapp.com`.

### A3 — Migrate the Coolify source, and prove it works — WHILE STILL PUBLIC

Only if A1 said *Public Repository*.

1. In Coolify, create the source per D2 (Deploy Key recommended):
   - **Deploy Key:** Coolify generates a keypair. Copy the **public** key to
     <https://github.com/kstruck/MMPoolsV3/settings/keys> → *Add deploy key*.
     Give it a name like `coolify-www`. **Leave "Allow write access"
     UNCHECKED** — Coolify only ever reads.
   - **GitHub App:** install Coolify's app on the `kstruck` account, granting it
     access to `MMPoolsV3` only.
2. Create the new application resource from the private-repo source type,
   pointing at `kstruck/MMPoolsV3`, branch `main`, build pack **Dockerfile**.
3. Restore every environment variable from A2, with the build-variable flags.
4. **Deploy it and verify the container is healthy** — while the repo is still
   public, so a mistake costs nothing.
5. Only once it is green, move the domain over from the old application, then
   keep the old one **stopped but not deleted** until §4 passes.

**Why this order works even though the repo is still public:** a Deploy Key
source clones over SSH as `git@github.com:kstruck/MMPoolsV3`, and SSH refuses
any key GitHub does not recognise — so a successful clone proves the key is
genuinely registered and authorised, which is exactly what the flip will later
depend on. Same for a GitHub App token, which is scoped by installation rather
than by repository visibility. You are testing the real auth path, not a
public-access shortcut.

### A4 — Settle the GitHub plan (D1)

If upgrading: <https://github.com/settings/billing> → upgrade to Pro. Do it
**before** the flip so the ruleset never spends a moment unenforced.

### A5 — Set the Actions spending limit deliberately (D3)

<https://github.com/settings/billing> → Actions spending limit / budgets.

Decide and set it on purpose. The default of $0 is a *hard stop*, not a
safeguard — and a repo whose entire review discipline is built on four required
checks does not degrade gracefully when the checks stop running. If you are
going the self-hosted-runner route, still set a small non-zero limit as a
cushion while you migrate.

### A6 — Confirm your local git credentials reach a private repo

On the Windows box, in `D:\march-melee-pools`:

```powershell
git ls-remote origin HEAD
```

It works today regardless, because the repo is public — so what you are really
checking is **what credential is stored**, not whether the command succeeds:

- Git Credential Manager holding your own GitHub login → fine, you are the owner.
- A **classic PAT** → needs the `repo` scope. `public_repo` alone will start
  failing on every `git pull` and `git push`.
- A **fine-grained PAT** → needs `MMPoolsV3` explicitly selected, with
  *Contents: Read and write*.

Same check for any local MCP GitHub server or `gh` CLI token you use from the
Windows machine. This is the most likely cause of a "it worked yesterday"
failure the morning after the flip.

### A7 — Write down the ruleset before you can lose it

Open <https://github.com/kstruck/MMPoolsV3/settings/rules> and screenshot the
main-branch ruleset. If you end up on a plan where it stops being enforced, or
you ever recreate it, this is the record.

⚠️ **While you are there, resolve a live contradiction in the repo's own
comments.** `.github/workflows/ci.yml` states the ruleset lists exactly four
contexts (`build-and-test`, `emulator-tests`, `security-audit`,
`nginx-validate`), and `secrets-scan` is **not** among them.
`.github/workflows/security-scan.yml` states *"The job name is a required status
check in the main-branch ruleset"* about `secrets-scan`. Both cannot be true.
The ruleset page is the authority; fix whichever comment is stale.

---

## 3. PART B — the flip

1. Go to <https://github.com/kstruck/MMPoolsV3/settings> → scroll to the
   **Danger Zone**.
2. **Change repository visibility** → **Make private**.
3. Read the confirmation dialog rather than clicking through it. GitHub lists
   what it is about to detach. Expected here: nothing of consequence — 0 forks,
   1 stargazer, no GitHub Pages.
4. Type the repository name to confirm.

That is the whole flip. It takes effect immediately.

---

## 4. PART C — verification, in this order

Do not consider the flip done until all six pass. Steps 1–2 are the ones that
protect production.

1. **Coolify deploy.** Trigger a manual redeploy of the www application. It must
   clone, build, and go healthy. A failure here shows as a git clone error in the
   build log — `could not read Username for 'https://github.com'` or
   `Permission denied (publickey)` — which is A1/A3 not having been done, and is
   fixed by finishing A3 or by the rollback in §5.
   ⚠️ Remember `Actions → Redeploy` rebuilds **current `main` HEAD**, not the row
   you were looking at (`mmp-deploy-and-operate` §2b, measured on Coolify
   v4.3.10).
2. **The site itself.** Hard-refresh the production site. Confirm it renders and
   that data loads — a `200` is not "the frontend is fine"
   (`RUNBOOK-SITE-DOWN.md` step 1).
3. **Actions.** Push a trivial commit on a branch and open a PR. Confirm both
   workflows run to completion, and that they are **billing the way you decided
   in D3** (check the billing page, or that the job ran on your self-hosted
   runner).
4. **Required checks.** On that same PR, confirm the four required contexts are
   still listed as required and still block the merge button. **If they are not,
   D1 was answered wrong** — the ruleset is silently unenforced.
5. **Claude Code on the web.** Start a fresh session against the repo and confirm
   it clones and that GitHub tooling works. If it cannot see the repo, reconnect
   GitHub under claude.ai → **Settings → Connectors**, re-authorising so the
   installation covers `MMPoolsV3`. (The org-level repository-access admin page is
   not the remedy here — `kstruck` is a personal account, not an organization.)
6. **Local machine.** In `D:\march-melee-pools`: `git pull --ff-only origin main`,
   then `git push` a throwaway branch. This is A6 proven rather than assumed.

Then: **delete the old Coolify application** if you created a new one, and update
`README.md` §Deployment Guide with the source type you settled on.

---

## 5. PART D — rollback

**Repository visibility is instantly reversible and lossless.** Settings →
Danger Zone → *Change visibility* → **Make public**. Stars and forks do not come
back (there are none), and nothing else is affected.

If Coolify starts failing after the flip and you cannot immediately fix the
source, **flip the repo back to public**. That restores the anonymous clone path
and buys you unlimited time to do Part A properly. This is the correct move, not
a defeat.

Note the deploy path fails *safe*: Coolify keeps the running container until a new
one succeeds, so a failed build is **usually not an outage** — that is
`RUNBOOK-SITE-DOWN.md`'s wording ("Prod is on the LAST GOOD artifact by default"),
and the hedge is deliberate there, so keep it. Verify the site is actually serving
rather than inferring it from the failed build. You most likely have time.

---

## 6. What does NOT break — verified, so you can stop worrying about it

- **Coolify never pushes to GitHub.** It clones and builds. There is no write
  path to break.
- **Webhooks keep working** on private repos, if any are configured.
- **Firebase deploys are entirely local.** `npx firebase deploy` builds from the
  files in `D:\march-melee-pools` and never contacts GitHub. Functions, rules and
  indexes are completely unaffected by repository visibility.
- **The application has no runtime dependency on GitHub.** No `raw.githubusercontent`
  or `github.com` fetch exists anywhere under `src/` — verified by search.
- **No forks to orphan.** The repo has **0 forks**. (The classic gotcha —
  existing forks stay public and keep the code visible — does not apply.)
- **No GitHub Pages.** `has_pages` is false.
- **Existing PR and issue links keep working for you.** Measured: **47 markdown
  files carry 231** `github.com/kstruck/MMPoolsV3/pull/N` links. They resolve for
  anyone with access, which after the flip is you.
- **`codex exec review` is unaffected.** It reads the local working tree and
  diff; CLAUDE.md §2c needs no change.
- **Dependabot still runs on private repos** — but see §7.
- **qodo** is DORMANT (CLAUDE.md §2b) and not part of any gate. Nothing to do.
- **The 1 stargazer** loses access. That is the entire external impact.

---

## 7. What silently degrades — accept these knowingly

### Secret scanning and push protection are lost

GitHub's free secret scanning and push protection cover **public** repositories.
On a private repo they require paid GitHub Secret Protection.

**Partial mitigation already exists:** the `secrets-scan` job
(`gitleaks/gitleaks-action@v2`, `fetch-depth: 0`) scans full history and **keeps
working** — gitleaks requires a `GITLEAKS_LICENSE` only for repositories owned by
an *organization*; `kstruck` is a personal account, so no license is needed and
repository visibility is irrelevant to it.

⚠️ **But it does not cover everything push protection did.** `security-scan.yml`
scopes **both** triggers to `branches: [main, master]`, so it does not run on
pushes to feature branches, nor on PRs whose base is another feature branch — and
this repo stacks PRs routinely. A secret committed on a stacked branch is caught
only when something finally targets `main`.

So the loss is two-fold: *when* the net sits (push protection fires at `git push`,
gitleaks at PR time) and *where* (every branch, versus only main-targeting
events). If that gap matters, widening `security-scan.yml`'s `pull_request:`
trigger to match `ci.yml`'s unfiltered one costs ~2 minutes per event.

### Dependabot needs its defaults checked

Dependency graph is on by default for public repos and is the thing Dependabot
alerts depend on. After the flip, confirm at
<https://github.com/kstruck/MMPoolsV3/settings/security_analysis> that
**Dependency graph**, **Dependabot alerts**, and **Dependabot security updates**
are all enabled. `.github/dependabot.yml` (weekly, Monday, npm, grouped
minor-and-patch) needs no change.

### 🛑 Going private is NOT history remediation

The repository was **created 2025-12-06** and is public today. GitHub does not
record when it *became* public, so treat the whole life of the repo as the
exposure window unless you remember otherwise. Anything ever committed has already
been fetched, mirrored and indexed by parties you cannot enumerate. Making it
private stops *new* eyes; it undoes nothing.

Concretely, for this repo: a Gemini API key sat in `.env` in public history from
2025-12-13 until commit `3340fff0`. **Rotation is CLOSED** (Kevin ruling,
2026-08-24 — the leaked value is dead), and `RUNBOOK-HISTORY-SCRUB.md` remains
**PREP ONLY, NOT EXECUTED**. Neither status changes because of this flip, and
the flip must not be treated as having addressed either.

---

## 8. Appendix — the Actions measurement

Taken 2026-08-28 from the GitHub API. Reproducible; do not take it on faith if
the numbers matter to a decision.

**Billable minutes per event** — GitHub rounds each *job* up to the whole minute.
A workflow run belongs to one workflow file, so this is sampled from **two** runs,
both cache-warm successes: `ci.yml` run 1571 (`33176258973`) and `security-scan.yml`
run `33174571565`.

| Workflow | Job | Measured | Billed |
|---|---|---|---|
| `ci.yml` | `nginx-validate` | 15s | 1 |
| `ci.yml` | `build-and-test` | 1m30s | 2 |
| `ci.yml` | `lint` | 1m11s | 2 |
| `ci.yml` | `emulator-tests` | 2m50s | 3 |
| `ci.yml` | `e2e-playwright` | 10m36s | **11** |
| `security-scan.yml` | `secrets-scan` | 10s | 1 |
| `security-scan.yml` | `security-audit` | 53s | 1 |
| | | | **19 or 21** |

**Event rate** — 120 consecutive runs of each workflow, spanning
2026-08-25T17:22Z → 2026-08-28T13:37Z (68.26 h):

- **42.2 events/day**, split 80 `pull_request` / 40 `push`, 0 scheduled.
- ⚠️ **The two workflows do NOT fire in lockstep.** `ci.yml` has a bare
  `pull_request:` trigger (no branch filter), while `security-scan.yml` scopes both
  triggers to `branches: [main, master]`. A PR whose **base** is another feature
  branch — this repo stacks PRs routinely — fires `ci.yml` only, for **19** minutes
  rather than 21. Sample run 1571 is exactly such a PR (base
  `claude/ui-switch-accessible-name`) and produced no `security-scan` run at all.

**Therefore:** 42 × 19–21 ≈ **800–880 billable min/day ≈ 24,000–26,000 min/month**.

**Caveats, stated rather than buried.** The per-event figure comes from one
cache-warm successful run; a Playwright cache miss (~150 MB of Chromium) or a
failing run costs more, so 21 is a floor. The rate window is one busy stretch in
late August — a quieter month is cheaper, but not by the order of magnitude that
would change D3.

**Where the money is:** `e2e-playwright` alone is 11 of `ci.yml`'s 19 minutes —
**~55% of the entire bill**. The 40 `push` runs re-validate trees their PR runs already
validated — **33% of runs**. Those are the two levers if you ever want to cut
cost without changing plan.
