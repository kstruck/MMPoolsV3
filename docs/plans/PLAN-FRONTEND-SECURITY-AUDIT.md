# PLAN — Frontend attack-surface audit fixes (codex audit, 2026-09-05)

**Status:** DRAFT — awaiting Kevin's answers to §6. No code written.
**Gate class:** PR B touches `firestore.rules` (authorization) → plan-gated per
`mmp-change-control` §1. PR A and PR C are ordinary (headers, output escaping,
hosting config) but ride under this plan for one review trail.

## 1. What codex claimed, and what verification found

Every claim was re-checked against the worktree at `79eac415` and against live
responses on 2026-09-05. Verdicts:

| # | Check | Codex | Verified | Evidence |
|---|-------|-------|----------|----------|
| 1 | Client-side secrets | PASS | **PASS — agree** | Bundle carries Firebase config + Sentry DSN only. Both are public by design. Evidence (2026-09-06, live bundle `assets/index-D7S5x1zU.js`): `grep -oE 'AIza[0-9A-Za-z_-]{35}' bundle.js \| sort -u \| wc -l` → **1** (the Firebase web API key; `Dockerfile:26-31` bakes only the six `VITE_FIREBASE_*` vars, and `Dockerfile:24` records `VITE_API_KEY` — the Gemini key — removed with its only client reader). `grep -oE 'sk_(live\|test)_\|whsec_\|AKIA[0-9A-Z]{16}' bundle.js` → **no matches**. `grep -rn "VITE_GEMINI\|GEMINI_API_KEY" src/` → **no matches**. The leaked-then-rotated Gemini key is history-only (memory `gemini-leak-correction`, verified `API_KEY_INVALID` 2026-08-24). |
| 2 | XSS | FAIL | **FAIL — confirmed** | `functions/src/emailUnsubscribeHttp.ts:47` interpolates `${email}` raw into the 200 page. `functions/src/announcements.ts:53-56` interpolates `pool.name`, `announcement.message` raw; `:60` passes `announcement.subject` to `renderEmailHtml` title unescaped. A shared `escapeHtml` already exists at `functions/src/emailStyles.ts:8` and is NOT used by either file. Client side: React escapes; the only `dangerouslySetInnerHTML` is the static JSON-LD block in `src/components/SEO.tsx:66`. |
| 3 | Clickjacking | FAIL | **FAIL — confirmed live** | `curl -D -` on `emailUnsubscribe`, `manageEmailPrefs`, `joinPreview` at `us-central1-gridiron-gamble-uzuqo.cloudfunctions.net` returned `content-type` only — no `X-Frame-Options`, no CSP. www and web.app both send `DENY` + `frame-ancestors 'none'`. |
| 4 | API exposure | FAIL | **FAIL on the checklist, NOT a defect** | Admin callable names are in the bundle because the SuperAdmin UI is part of the SPA. Authority is the server gate (`functions/src/lib/assertRole.ts`, custom claim + stored role). Discoverability of a callable name grants nothing. Rejecting codex fix #5 — see §5. |
| 5 | Server-side input validation | FAIL | **FAIL — confirmed** | `firestore.rules:621-628` (announcements) checks WHO writes, not WHAT: no key allowlist, no types, no length caps, `authorId`/`createdAt` unchecked. `firestore.rules:857-868` (users) blocks six privileged keys on self-update and nothing else. Client writes announcements directly via `addDoc` (`src/components/AnnouncementManager.tsx:48`). |
| 6 | Security headers | FAIL | **FAIL — confirmed live** | Function HTML responses: none of CSP/HSTS/nosniff/Referrer-Policy. `gridiron-gamble-uzuqo.web.app`: has CSP, HSTS, nosniff, XFO; **missing `Referrer-Policy` and `Permissions-Policy`** (`firebase.json` `hosting.headers` `**` block has neither; `nginx.conf:35-46` has both). |

**Score: 1/6, agreed.** Severity is lower than the score reads: item 2 needs a
valid HMAC token for the hostile email string, item 4 is by design, item 5 is
commissioner-only writes. Items 3 and 6 are the cheapest real gaps.

### Codex fix list — accept / reject

| Codex fix | Verdict | Reason |
|-----------|---------|--------|
| 1. Escape dynamic HTML | **ACCEPT** → PR A | Confirmed at three sites. Helper exists; wire it. |
| 2. Headers on every HTML endpoint + align hosting with nginx | **ACCEPT** → PR A (functions) + PR C (firebase.json) | Confirmed live. |
| 3. Validate direct Firestore writes | **ACCEPT, split** → PR B (announcements) + PR B2 (users, after field inventory) | Rules are plan-gated. Users schema needs an inventory of every client write path first or it breaks profile saves. |
| 4. Restore App Check | **REJECT for now — DECISION D1** | HANDOFF.md:3023 records App Check taking prod DOWN on 2026-07-30 and the root cause is still open (three candidates, none checked). The standing instruction is "do NOT set `VITE_RECAPTCHA_SITE_KEY`". Also the site CSP `script-src` lists no `www.google.com`/`www.gstatic.com`, so the reCAPTCHA loader would be refused even if the key reached the bundle. Not a one-PR fix; needs its own plan. |
| 5. Move admin UI out of the public app | **REJECT** | No security gain: the server gate is the authority regardless of where the UI lives, and a second deployable adds a second attack surface + a second deploy ritual. Kept as-is. |
| 6. Drop `'unsafe-inline'` from script-src | **DEFER — DECISION D4** | `functions/src/cspReport.ts` exists precisely to collect violation data before tightening. Read `system_logs/csp-violations-*` first; Vite emits inline module preload scripts that may need a hash. Separate PR after data. |

## 2. PR A — functions: shared security headers + output escaping (ordinary)

Files: `functions/src/lib/httpHeaders.ts` (new), `emailUnsubscribeHttp.ts`,
`emailPrefsPage.ts`, `joinPreview.ts`, `announcements.ts`, `emailStyles.ts`
(export only), `functions/src/__tests__/httpSurfaceInvariants.test.ts`,
`tests/csp-invariants.test.ts`, new unit tests.

1. **`setSecurityHeaders(res, profile)`** with two profiles:
   - `"page"` (self-contained HTML: unsubscribe, prefs, crawler preview):
     `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
     (inline `style=` attributes are used throughout these templates, so
     `style-src 'unsafe-inline'` is required; `form-action 'self'` covers the
     prefs POST-back.)
   - `"spa"` (joinPreview's human path serves the real `index.html`): the SITE
     CSP verbatim, exported as one constant so the SPA shell behaves the same
     from the function as from nginx. `tests/csp-invariants.test.ts` today
     guards nginx ×3 + firebase.json ×1; extend it to assert the functions
     constant is byte-equal to those four. Five copies, one test.
   - Both profiles: `X-Frame-Options: DENY`, `Strict-Transport-Security:
     max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`,
     `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 0`,
     `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
   - Call it FIRST in each handler so 400/403/405 bodies get headers too
     (codex fix 2 says "including success and error responses" — correct).
2. **Escaping.** `emailUnsubscribeHttp.ts`: import `escapeHtml` from
   `./emailStyles`, wrap `${email}`. `emailPrefsPage.ts`: delete its private
   copy of `escapeHtml`, import the shared one (one helper, one home).
   `announcements.ts`: escape `pool.name`, `announcement.subject`,
   `announcement.message` before templating. `message` keeps `white-space:
   pre-wrap`, so escaping does not change how line breaks render.
3. **Sweep.** `grep -rn '\${[a-zA-Z.]*\(name\|subject\|message\|title\|displayName\)}' functions/src --include=*.ts` and
   verdict every hit that lands inside an HTML template. Record hits + verdicts
   in the PR body. (Known already-safe: billing, invites, manualReminders,
   monetizationAlerts import `escapeHtml`.)
4. **Tests (ship with the PR, per standing rule).**
   - `httpSurfaceInvariants.test.ts`: new case — every `onRequest` handler that
     `.send(`s HTML calls `setSecurityHeaders`. Grep-style, same shape as the
     existing 405 guard.
   - Unit test for `emailUnsubscribe`: sign a token for
     `"<img src=x onerror=alert(1)>"@x.test` with a fixture secret, call the
     handler, assert body contains `&lt;img` and not `<img`; assert every
     header above is present on the 200 AND on the 403 path.
   - Unit test for the announcements body builder (extract `buildAnnouncementHtml`
     so it is testable): `<script>` in message/subject/pool name comes out
     escaped.
   - `tests/csp-invariants.test.ts`: fifth-copy equality.

## 3. PR B — `firestore.rules`: announcement write schema (PLAN-GATED)

Current (`firestore.rules:621-628`): `allow create, update, delete` on
commissioner identity only.

Target:
```
allow create: if isPoolCommissionerOrSA()
  && request.resource.data.keys().hasOnly(['poolId','authorId','subject','message','createdAt','readBy'])
  && request.resource.data.keys().hasAll(['poolId','authorId','subject','message','createdAt'])
  && request.resource.data.poolId == poolId
  && request.resource.data.authorId == request.auth.uid
  && request.resource.data.subject is string
  && request.resource.data.subject.size() >= 1 && request.resource.data.subject.size() <= 200
  && request.resource.data.message is string
  && request.resource.data.message.size() >= 1 && request.resource.data.message.size() <= 5000
  && request.resource.data.createdAt == request.time
  && request.resource.data.readBy is list && request.resource.data.readBy.size() == 0;
allow update: if <same commissioner check>
  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['subject','message','readBy'])
  && <same subject/message bounds>;
allow delete: if <same commissioner check>;
```
- `createdAt == request.time` works because the client sends
  `serverTimestamp()` (`AnnouncementManager.tsx:53`).
- Limits match the email path: 200/5000 keep `sendEmail` payloads bounded.
- **Inventory before writing:** grep `src/` for every write to
  `announcements` (`addDoc`/`updateDoc`/`setDoc`, and `readBy` `arrayUnion`
  from readers, if any — a reader-side `readBy` update would need its own
  clause and the allowlist above would break it). Record the inventory in the
  PR body.
- Tests: new `functions/scripts/announcements.rules.test.mjs` — commissioner
  create passes; extra key fails; 5001-char message fails; `authorId` ≠ uid
  fails; client-supplied `createdAt` fails; non-commissioner fails; update
  touching `poolId` fails.
- Deploy: functions are untouched, so `npx firebase deploy --only firestore:rules`
  after the §3 step-zero pull.

## 4. PR B2 — `firestore.rules`: users profile schema (PLAN-GATED, DECISION D2)

Bigger blast radius: every profile save, onboarding create, settings toggle
goes through `users/{uid}`. Do NOT write rules until an inventory of every
client write to `users/` exists (grep `src/` for `doc(db, 'users'` +
`updateDoc|setDoc`), listing each key written. Then: key allowlist, `is string`
+ size caps on free-text fields (displayName, bio, paymentHandles.*,
socialLinks.*), keep the existing six-key privileged block. Rules tests as §3.

## 5. PR C — `firebase.json` hosting header parity (ordinary)

Add to the `**` headers block: `Referrer-Policy: strict-origin-when-cross-origin`
and `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Extend
`tests/csp-invariants.test.ts` (or a sibling) to assert the non-CSP header SET
in `firebase.json` equals the set in `nginx.conf`. Can fold into PR A if Kevin
prefers one PR; kept separate because it changes a different deploy surface
(`npx firebase deploy --only hosting`).

## 6. DECISIONS NEEDED (Kevin)

- **D1 — App Check.** Recommend: leave OFF, reject codex fix 4 for this plan,
  open a separate plan whose first step is Kevin reading the Coolify deployment
  history for 2026-07-30 (HANDOFF.md:3023 lists the three candidate causes).
  On "approve as recommended": no App Check change in any PR here.
- **D2 — Users profile schema (PR B2).** Recommend: do it, but only after the
  write inventory; ship as its own PR after PR B lands. On "approve as
  recommended": PR B2 follows PR B, inventory in its PR body.
- **D3 — Admin UI relocation.** Recommend: reject. On "approve as
  recommended": no change; the rejection reasoning above goes in the PR A body.
- **D4 — CSP `'unsafe-inline'`.** Recommend: defer; read
  `system_logs/csp-violations-*` first, then a separate PR. On "approve as
  recommended": no CSP tightening in any PR here.
- **D5 — PR A + PR C as one PR or two.** Recommend: two (different deploy
  surfaces, different rollback). On "approve as recommended": two PRs.

## 7. Gates (every PR)

Seven-command list from CLAUDE.md §2e, codex `--base origin/main` rounds until
clean, qodo watcher via `mmp-qodo-cycle`, own read of the diff. PR B/B2 carry
this plan's path in the PR body.
