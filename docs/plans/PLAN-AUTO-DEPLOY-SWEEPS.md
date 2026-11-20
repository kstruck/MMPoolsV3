# PLAN-AUTO-DEPLOY: sweeps

Built on `origin/main` @ `b04f6b0b`.

## S1: every tracked file that states the deploy is manual

`git grep -n -i -c "manual trigger\|manually trigger\|does \*\*not\*\* auto-deploy\|does NOT deploy the frontend\|Coolify dashboard\|pull --ff-only origin main" -- ':!docs/archive' ':!docs/plans'`

| File | Hits | Phase 3 action |
|---|---|---|
| `CLAUDE.md` | 3 | Rewrite §3: the workflow is the deploy, the Windows ritual is the fallback |
| `HANDOFF.md` | 4 | Update the environment facts block |
| `README.md` | 1 | Update the deployment guide |
| `.claude/skills/mmp-deploy-and-operate/SKILL.md` | 5 | Rewrite §1 and §2 around the workflow; keep §1a, §1c, §1d and §2b |
| `.claude/skills/mmp-change-control/SKILL.md` | 2 | Rule 2 and §6 ("Prod www frontend deploy" is no longer Kevin-only) |
| `.claude/skills/mmp-config-and-flags/SKILL.md` | 2 | Build args move from Coolify to GitHub environment variables |
| `.claude/skills/mmp-nfl-season-campaign/SKILL.md` | 2 | Correct the deploy references |
| `.claude/skills/mmp-architecture-contract/SKILL.md` | 1 | Correct |
| `.claude/skills/mmp-debugging-playbook/SKILL.md` | 1 | Correct ("my deployed fix isn't visible") |
| `.claude/skills/mmp-docs-and-writing/SKILL.md` | 1 | Correct |
| `.claude/skills/mmp-failure-archaeology/SKILL.md` | 1 | Keep as history; add the date it stopped being true |
| `.claude/skills/mmp-product-frontier/SKILL.md` | 1 | Correct |
| `.claude/skills/mmp-superadmin-surface/SKILL.md` | 1 | Correct |
| `tests/docs-state-invariants.test.ts` | 1 | Read before editing any doc it pins; update with the docs |
| `docs/backlog/MORNING-2026-08-22-FIXES.md` | 2 | Dated record: leave |
| `docs/backlog/TOMORROW-TASKS.md` | 2 | Dated record: leave |
| `functions/src/nflPools.ts` | 1 | A code comment at `:924` that explains a behaviour by "Coolify is a manual trigger". Reword the comment when Phase 2 lands; no logic change |
| `functions/src/expertPicks.ts`, `scripts/fixPoolScores.js` | 1 each | Not about deploys (a job or script run by hand): leave |

`docs/archive` and `docs/plans` are excluded on purpose: they are records of
what was true when written.

## S2: every command in the repo that deploys

`git grep -n "firebase deploy" -- package.json functions/package.json`

| Where | Command | After this plan |
|---|---|---|
| `package.json` `deploy:backend` | functions, rules and indexes in one command, project pinned | Kept as the manual fallback. The workflow does not call it, because it cannot order rules (§4.3) |
| `package.json` `deploy:hosting` | Firebase Hosting, which does not serve prod `www` | Unchanged, unused by the workflow |
| `functions/package.json` `deploy` | functions only, **no `--project`** | The workflow does not call it. Flag for Phase 3: pin the project or remove it |

No workflow under `.github/workflows` deploys anything today (`ci.yml`,
`security-scan.yml`).

## S3: the surfaces `firebase.json` declares

`node -e "console.log(Object.keys(require('./firebase.json')))"` gives
`functions`, `firestore`, `hosting`, `emulators`.

| Surface | Deployed by the workflow? |
|---|---|
| `functions` (88 `export` lines in `functions/src/index.ts`) | Yes |
| `firestore.rules` | Yes, order chosen per §4.3 |
| `firestore.indexes.json` | Yes, additions only (§4.4) |
| `hosting` | No. Prod `www` is the Coolify container |
| Storage rules | None declared, nothing to deploy |

There is no `.firebaserc`, so no default project exists and every command
must name one.

## S4: build arguments the `www` image needs

`grep -n "^ARG" Dockerfile`

`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
`VITE_FIREBASE_APP_ID`, `VITE_SENTRY_DSN`, `VITE_SENTRY_REPLAY_SAMPLE_RATE`.

All eight are inlined into the public bundle, so they are GitHub environment
**variables**, one set per environment, never secrets.
`VITE_RECAPTCHA_SITE_KEY` is deliberately absent from the Dockerfile and must
stay absent (App Check is blocked, `mmp-change-control` §6).
`mmp-change-control` §6 also records two malformed values in Coolify today
(`STORAGE_BUCKET`, `AUTH_DOMAIN`); Phase 2 copies the values with Kevin and
fixes them then, not silently.

## S5: secrets the functions read at deploy time

`grep -rhoE "defineSecret\(['\"][A-Z_0-9]+" functions/src | sort -u`

`COURIER_AUTH_TOKEN`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

They live in Secret Manager, per project. The deploy identity needs to see
that they exist, not to read their values (role list UNVERIFIED, plan §4.7).
Staging gets its own four, with Stripe test keys and no live Courier token.

## S6: scheduled jobs a staging project would run

`git grep -l "onSchedule(" -- functions/src | wc -l` gives 30 files;
`git grep -n "onSchedule(" -- functions/src | wc -l` gives 59 matches, which
includes imports and comments, so the job count is lower and is to be listed
exactly in Phase 1 from `functions:list` on staging.

## S7: tests that pin deploy mechanics

| Test | Pins | Affected? |
|---|---|---|
| `tests/dockerfile-build-parity.test.ts` | Dockerfile build steps equal `build:static`; `npm ci` | No: the workflow builds the same Dockerfile. §4.8 adds a version file, which must not break the parity |
| `tests/dockerfile-sentry-env.test.ts` | Sentry build args reach the build | No |
| `tests/deploy-bundle-invariants.test.ts` | What `firebase deploy --only functions` uploads | No |
| `tests/loop-engineering-invariants.test.ts` | `ci.yml` contents and the lint cap | No: `ci.yml` is not edited; the workflow is a new file |
| `tests/docs-state-invariants.test.ts` | Deploy-state claims in operator docs | Yes in Phase 3 (S1) |

## S8: production identifiers hard-coded where staging would inherit them

`git grep -n -c "gridiron-gamble-uzuqo\|marchmeleepools\.com" -- nginx.conf src public index.html firebase.json functions/src shared scripts/prerender.ts Dockerfile`

| Group | Files (hit count) | Phase 1a treatment |
|---|---|---|
| Container config | `nginx.conf` (7): CSP `connect-src`, CSP report endpoint ×3, `/join` proxy host | Per-environment at image build or container start. Must stay valid for the `nginx-validate` job |
| Functions, money path | `functions/src/stripe.ts` (2) | Per-environment site origin. Plan-gated (money) |
| Functions, other | `statsTrigger.ts` (2), `squares.ts`, `securityNotices.ts`, `joinPreview.ts`, `joinPreview.helpers.ts`, `emailStyles.ts`, `cspReport.ts` (1 each) | Per-environment site origin or project id |
| Shared | `shared/emailPromo.ts` (1) | Per-environment site origin |
| Frontend code | `src/components/ContactPage.tsx` (4), `src/services/emailService.ts` (2), `TermsPage.tsx` (2), `SEO.tsx` (2), `PrivacyPage.tsx` (2), `seoConfig.ts`, `SupportPage.tsx`, `HowItWorksPage.tsx` (1 each) | Classify each: a contact address or legal text naming the company stays; a link or canonical URL becomes per-environment |
| Static files | `public/sitemap.xml` (15), `index.html` (6), `public/.well-known/api-catalog` (4), `public/auth.md` (3), `public/robots.txt`, `public/api/openapi.json`, `public/api/docs.html` (1 each) | Staging must not be indexed: serve a deny-all `robots.txt` and no sitemap on staging. Canonical URLs stay production's |
| Hosting config | `firebase.json` (2) | Firebase Hosting does not serve prod `www` (S3): leave |
| Tests | `functions/src/__tests__/cspReport.test.ts` (4), `nflPickConfirmation.test.ts`, `emulator/setup.ts` (1 each) | Update with the code they pin |

This list is by file. Phase 1a starts by expanding it to every line, since
"a domain in a legal page" and "a domain in a redirect" need opposite
answers.
