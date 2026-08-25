# RUNBOOK — "The site is down"

One page. Read top to bottom; each step tells you where to be, the exact
command, what a healthy answer looks like, and where to go when it is not.

**Scope.** Prod www (`https://www.marchmeleepools.com`) is unreachable, blank,
stuck on a spinner, or serving something visibly wrong. If the site loads and
one FEATURE is broken, this is the wrong document — go to
`.claude/skills/mmp-debugging-playbook/SKILL.md` §1 (client vs rules vs function
decision tree) instead.

**Two facts to hold before you touch anything.**

- The frontend and the backend fail independently. `www` is nginx in a Docker
  container on Coolify, behind Cloudflare; auth, Firestore and callables go
  **client → Google direct** and never cross that edge. A dead frontend and a
  dead backend look similar to a user and have nothing to do with each other.
- **Prod is on the LAST GOOD artifact by default.** Cloud Run keeps the previous
  revision serving when a new one fails its healthcheck, and Coolify keeps the
  running container until a new one succeeds. So "a deploy failed" is usually
  **not** an outage. If the site is genuinely down, something SUCCEEDED and was
  wrong — which is why step 2 is a rollback, not a fix.

---

## Step 0 — the alert

**Where it comes from.** GCP Uptime Checks probe the public site and the
`readiness` endpoint; alerts route through Cloud Monitoring into the ops alert
dispatcher (email + SMS). See `PLAN-SECURITY-OBSERVABILITY.md` §13.

**First question: is it really down, or is it you?** Load the site in a browser
on a different network (phone on cellular). The 2026-07-30 outage was confirmed
from two independent machines and networks before anyone touched a control —
that confirmation is what made the diagnosis trustworthy.

If two independent networks see it, continue. If only you do, it is DNS or local
cache; hard-refresh and stop here.

---

## Step 1 — curl the bundle hash

**Where:** any PowerShell prompt, any directory. **`curl.exe`, not `curl`** —
bare `curl` is an alias for `Invoke-WebRequest` and takes different arguments.

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://www.marchmeleepools.com/
curl.exe -s https://www.marchmeleepools.com/ | Select-String "index-[A-Za-z0-9_-]*\.js"
```

**What each answer means:**

| Result | Reading | Go to |
|---|---|---|
| `200` + a bundle hash, **and the browser shows a permanent spinner / blank page** | ⚠️ **This is the S7b signature.** The shell is served fine and the app never comes alive — curl cannot see the difference, only the browser can | **Step 2** — do NOT skip to step 3 |
| `200` + a bundle hash, **and the browser renders but something is wrong** | HTML and JS are fine; the failure is in what the app talks to | Step 3 |
| `200` but NO bundle line | nginx is serving something that is not the SPA shell — a bad build, or a wrong container | Step 2 |
| `502` / `503` / `504` | The container is not serving. Coolify build or container failure | Step 2 |
| connection refused / DNS failure / Cloudflare error page | Edge or host problem, not a code problem. Check the Cloudflare dashboard and the Coolify host before deploying anything | Step 2 only after the edge is ruled out |

🛑 **A `200` is not "the frontend is fine".** The one known way to kill this
site stone dead — step 2a — leaves nginx serving a perfect `200` and the correct
bundle while the app never finishes booting. `/readiness` in step 3 will usually
be **green** during it, because the backend genuinely is healthy. So a blank or
spinning browser on a `200` goes to step 2, always; treating it as a backend
problem is how that outage costs an hour instead of a minute.

**The hash is the deploy fingerprint.** Compare it to the hash the last known
good deploy recorded (`HANDOFF.md`'s live-state box carries it). A hash you do
not recognise means a deploy landed. A hash that matches the last good one means
the frontend did NOT change and the fault is behind it — jump to step 3.

⚠️ Docs-only commits produce identical bundles (`*.md` is dockerignored since
#553), so **two different commits can share a hash**. The hash proves a build
changed; it never proves which commit is serving. Coolify's deployment row is
the authority on the SHA.

---

## Step 2 — is it the App Check outage? Then roll back

### 2a. Check the one known way to kill this site stone dead

**Symptom that matches:** the whole site renders nothing — permanent spinner, no
data, no error — right after a Coolify rebuild.

That is `mmp-debugging-playbook` **row S7b**, the 2026-07-30 outage. Read that
row before acting; the summary is:

- **What is known:** setting `VITE_RECAPTCHA_SITE_KEY` in the Coolify
  environment preceded the outage, and deleting it restored service.
- **What is NOT known: why.** The first theory (the Firestore SDK blocking on an
  App Check token that CSP will not let resolve) is **holed** — `Dockerfile`
  declares no build `ARG` for that key, so it has no known path into the bundle.
  Treat the cause as OPEN and do not restate the mechanism as fact.

**Do this:** read the Coolify environment for `VITE_RECAPTCHA_SITE_KEY`. If it
is set — **delete it and redeploy.** That restored service last time.

Then check the browser console for a CSP refusal of
`https://www.google.com/recaptcha/enterprise.js`. **If that refusal is absent,
the App Check theory is wrong for your incident too**: compare the two Coolify
deploy logs and diff the served bundle instead.

⛔ **The inverse is also a rule: do not SET that variable to fix anything.**
`src/firebase.ts` initializes App Check only inside the site-key conditional, and
that conditional is pinned by `tests/docs-state-invariants.test.ts`. The absent
key is the intended production state.

### 2b. Roll the frontend back

Full procedure with the traps: `.claude/skills/mmp-deploy-and-operate/SKILL.md`
**§2b** (tested live, round trip verified). The three things that matter under
pressure:

1. **`Actions → Redeploy` is roll-FORWARD only.** It rebuilds current `main`
   HEAD no matter which deployment row you were looking at. It will not undo
   anything.
2. **True rollback:** app page → left sidebar → **Operations → Rollback** →
   *"Roll back to this image"* on the target commit's row. Restarts the old
   image, no rebuild, seconds.
3. **Prove it moved:** re-run step 1's curl. The hash must flip. A rollback that
   leaves the same hash did nothing.

⚠️ **Image retention is your rollback window** ("Images to keep" on that page).
If the good image has been pruned, the recovery is roll-forward:
`git revert <bad-sha>` on `main`, then `Actions → Redeploy`.

**If the site is back after this, stop and write up what happened.** If it is
not, the frontend was not the fault — continue.

---

## Step 3 — is the backend up? `/readiness`

**Where:** any PowerShell prompt.

```powershell
curl.exe -s -w "`n%{http_code}`n" https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net/readiness
```

**What it does** (`functions/src/readiness.ts`): a GET or HEAD triggers a cheap
read of the always-present `system/config` document, raced against a 5-second
timeout. Deliberately tiny — no internals, no auth, because GCP Uptime Checks
send unauthenticated GETs.

| Response | Meaning | Next |
|---|---|---|
| `200` + `OK` | The functions runtime is up AND can reach Firestore | The backend is healthy; the fault is client-side or in one specific callable → `mmp-debugging-playbook` §1 |
| `503` + `UNAVAILABLE` | The function ran but could not read Firestore inside 5s | Firestore or IAM problem, not a code deploy. Check the Google Cloud status page, then step 4's logs |
| `405` + `Method Not Allowed` | **You sent a POST.** That is the correct answer to a POST since #547 and is itself proof the endpoint is deployed — but it is not a health signal. Re-run with a GET | rerun |
| timeout / connection error / `404` | The function itself is not serving. This is a functions-deploy problem | Step 4, then §1d rollback |

⚠️ **`/readiness` is not the app.** It proves the runtime and Firestore
reachability, nothing about any individual callable. A green readiness with a
broken product is normal and expected — it means you are looking in the wrong
place, not that nothing is wrong.

---

## Step 4 — read the function logs

**Where:** `D:\march-melee-pools` (`firebase-tools` is a devDependency of the
repo root; `npx firebase` from anywhere else fails with *"could not determine
executable to run"*).

```powershell
cd D:\march-melee-pools
npx firebase functions:log --project gridiron-gamble-uzuqo
```

For one function:

```powershell
npx firebase functions:log --only <functionName> --project gridiron-gamble-uzuqo
```

🛑 **`--project` is not optional here.** A worktree has no `.firebaserc`
default, and logs pulled from some other active project come back convincingly
empty — which is also the signature of the §1c healthcheck flake. An empty log
is only evidence when you know which project you read.

**What to look for:**

- *Silence, then `STARTUP TCP probe failed … DEADLINE_EXCEEDED`* — §1c's
  infra flake, non-deterministic across retries. Not an outage on its own
  (Cloud Run keeps the last good revision), but it can split the fleet across
  two bundles. §1c has the retry rules, including the ten-minute wait.
- *An exception or module error at startup* — a real code fault in a deployed
  bundle. Roll the functions back: `mmp-deploy-and-operate` **§1d**.
- *`permission-denied` from Firestore* — a rules deploy, not a functions
  deploy. §1a's ordering table is the reason and the fix.
- *Nothing at all, for a function you are actively invoking* — the client is
  not reaching it. Back to step 1; this is a frontend or edge problem.

Richer detail than the CLI: the in-app **API Status Center** / `adminHealth`
snapshot (`health/latest`) and `system_logs`, both covered by
`mmp-diagnostics-and-tooling`.

---

## Step 5 — functions rollback, if that is where it landed

`.claude/skills/mmp-deploy-and-operate/SKILL.md` **§1d**. The one-line version
of the trap, because it is the opposite of the Coolify one:

🛑 **A functions rollback is a REDEPLOY, and `firebase deploy` builds from
LOCAL FILES.** There is no stored artifact to point at. What ships is the state
of the working tree in `D:\march-melee-pools` at the moment you run the command
— and a stale or wrong tree ships the wrong code while printing
`✔ Deploy complete!`. §1d walks it step by step, including **putting the
checkout back on `main` afterwards**, which is the step whose omission arms the
next person's deploy with your rollback.

---

## After it is over

1. **Write what actually happened, and mark the unknown parts unknown.** The
   S7b row is useful precisely because it separates *"deleting the variable
   fixed it"* from *"here is why"*, and refuses to assert the second.
2. **Update `HANDOFF.md`'s live-state box** with the serving bundle hash and the
   deploy state, so the next incident's step 1 has something to compare against.
3. **An unexplained way to kill prod is worse than an understood one.** If the
   cause is still open, that is a finding to carry, not a ticket to close.
