# Plan Review Log: Tooltips + Dashboard Help panel

Act 1 (self-interview grill; Kevin unavailable — every Kevin-only question is
in PLAN-HELP-SYSTEM.md §6) complete 2026-08-16. MAX_ROUNDS=5 for this
docs-only artifact (paid runs; stop on APPROVED). PLAN_FILE=PLAN-HELP-SYSTEM.md.
Each round is a fresh `codex exec -s read-only` session with `</dev/null`
(the resume path hangs on this machine — see memory "Codex exec stdin gotcha").
Prompt per round is the one in the task brief (adversarial, read-only, ends
with a single VERDICT line). Raw outputs:
`C:\Users\kevin\AppData\Local\Temp\claude\plan-help-round<N>.txt`.

## Round 1 — Codex (fresh session, codex-cli 0.144.5)

VERDICT: REVISE. 13 findings, no severity tags given by codex; severities
below are mine.

1. (High) `HelpEntry` has one `page`, but the same option appears in wizard,
   manager, rules and member surfaces — duplicating it per page breaks the
   one-copy promise. Fix: split `HelpTopic` (copy) from `HelpPlacement`.
2. (High) `helpId` defaulting to `name` is ambiguous across pool types
   (`settings.entryFee`) while `HelpTip` has no pool type. Fix: qualified key
   `NFL_PICKEM:settings.entryFee` via a required scope context.
3. (Medium) Dynamic paths (`props.questions.${i}.*`, payout rows) never match
   exact keys. Fix: normalise indices to `*`; wire raw `register()` controls
   explicitly.
4. (Medium) Tooltip "More in Help" targets an entry id but the panel anchors
   by section group. Fix: entry-level anchors; expand accordion, then scroll.
5. (Medium) `role="tooltip"` containing a clickable link is invalid and
   unreachable by pointer once the trigger is left. Fix: non-interactive
   tooltip; the trigger's click is the action.
6. (Medium) `?` opens over Auth/Share/QuickPicks dialogs. Fix: suppress when
   another `role=dialog`/`aria-modal` is open.
7. (High) Search / All pages can only `navigate()` to a route — Props,
   Playoff, AdminPanel, SuperAdmin, manager sub-tabs are in-memory. Fix:
   registered activation or URL-encoded tabs.
8. (Medium) `useHelpRoute` publisher list ("six") omits ParticipantDashboard,
   HowItWorks views, Scoreboard modes, SuperAdmin nested sub-tabs. Fix:
   inventory all in-memory views.
9. (High) "Every option" inventory misses `Props/PropsManager.tsx`, Playoff
   ranking/tiebreaker form, invite-by-email, announcements, payout recording,
   member card controls. Fix: extend inventory to every pool-owned form.
10. (Medium) `<label>` vs `<HelpTip>` counting is not a valid coverage test.
    Fix: explicit markers.
11. (Medium) Walking zod internals is brittle in zod 4 and cannot prove a
    rendered option has help. Fix: UI metadata primary, schema supplemental.
12. (Low) Header-only trigger leaves header-less routes without the button.
    Fix: global trigger or per-route fallback.
13. (Low) Client-side `audience` filtering still ships admin copy to every
    browser. Fix: lazy-load an admin-only chunk.

### Claude's response

Verified before acting: `Props/PropsManager.tsx` exists (21 controls);
`src/pages/PaymentSuccess.tsx` has 0 `Header` references; `Scoreboard.tsx:61`
holds an in-memory `nfl|college|basketball` tab; HowItWorks is URL-driven
(`useSearchParams`, `HowItWorksPage.tsx:227-231`) so it is NOT a publisher gap;
`NFLUserBentoDashboard`'s nav sets the parent tab (not a gap). Zod is 4.4.3 in
both `package.json` and `shared/package.json`.

- 1 ACCEPT — §3 D1 now has `HelpTopic` + `HelpPlacement` + `HelpPage`.
- 2 ACCEPT — `HelpScope` context (`src/help/scope.tsx`) provided by
  `WizardShell` (already has `poolType`), `PoolRoute`, `AdminRoute`; lookup
  `${poolType}:${id}` → `${id}`; T1 updated.
- 3 ACCEPT — `.<digits>.` → `.*.` normalisation; the two raw sites named.
- 4 ACCEPT — `id="help-topic-<id>"` per topic; `openTo` expands then scrolls
  and focuses.
- 5 ACCEPT — tooltip is text-only `role="tooltip"`; click/tap/Enter opens the
  panel (this is Spectrum's real behaviour, `HelpTooltip.tsx:6,73-77`). K2
  reworded accordingly.
- 6 ACCEPT — dialog guard added to `useHelpShortcut`.
- 7 ACCEPT — `HelpPage.href(ctx)`; new K13 asks Kevin whether to adopt
  `?tab=` on Props/Playoff/AdminPanel/NFL manager sub-tabs (recommend yes for
  pool surfaces, unlinked for super-admin sub-tabs).
- 8 ACCEPT (partly) — publisher list is now "SWEEPS §A2 + Scoreboard", with
  the two non-gaps recorded above; T2 done-when requires a per-page listing.
- 9 ACCEPT — new SWEEPS §E (measured: 48 pool-owned files with controls,
  with counts); §2d and T6/T7 rewritten to be driven by it.
- 10 ACCEPT — `ui/FieldLabel` (requires `helpId` or `data-help-exempt`);
  the test asserts zero raw `<label` in listed files + every literal resolves.
- 11 ACCEPT — UI coverage test is primary; schema walk demoted to a
  supplemental audit with a `z.toJSONSchema()` fallback noted.
- 12 ACCEPT — header-less routes are "shortcut-only" allowlist rows; K3
  notes the FAB alternative removes the row.
- 13 ACCEPT — `content/super-admin.ts` becomes a lazy chunk gated on the
  admin claim. Noted that nothing in it is a secret (rules/callables are the
  authority) — the motive is bundle size + hygiene.

No rejections this round. Plan revised; SWEEPS §E added.

## Round 2 — Codex (fresh session)

VERDICT: REVISE. 7 findings (round-1 fixes otherwise held).

1. (High) The proposed selector `'[role="dialog"]: not(...)'` has whitespace
   inside `:not` and would throw on every keydown. Fix: `:not(...)` + a test
   with an existing dialog open.
2. (High) `openTo` had three contradictory signatures. Fix: one
   `openTo({ topicId, pageId? })` + pending-target navigation state.
3. (Medium) "One source" still lets page `summary`/`title`/section headings
   drift, and a topic on several pages has no framing rule. Fix: scope the
   invariant to option/concept copy; require setting explanations elsewhere
   to render a topic field.
4. (Medium) `data-help-exempt="reason"` is unbounded. Fix: typed central
   allowlist `{file, control, reason}`; fail on unconsumed/unapproved rows.
5. (Medium) T6 omits the three child steps `PropsWizard` renders
   (`WizardStepGame/Branding/Reminders.tsx`). Fix: name them.
6. (Low) `PayoutGallery.tsx` (commissioner Mark Paid/Undo) is unimported but
   not recorded as dead. Fix: inventory + delete/exempt decision.
7. (Low) `HelpPlacement.section` optional but the panel assumes a group.
   Fix: required or normalised default.

### Claude's response

Verified: the plan text did break the selector across a line with a space
(`:\n  not(`) — a real typo that would have become a real bug; `PayoutGallery`
has zero importers and 2 controls (`:87`, `:96`); `PropsWizard.tsx:2-4` imports
the three root `WizardStep*` files.

- 1 ACCEPT — single-line selector in a named helper; test case added to D3.
- 2 ACCEPT — one `openTo({ topicId, pageId? })` + `openPage(pageId)`;
  pending-target navigation described; the four call sites in the plan now
  use it.
- 3 ACCEPT — D1 gains a "scope of the one-source invariant" paragraph:
  option/concept copy only; page framing is per-page by design; rules pages
  render topic fields (T8 guard).
- 4 ACCEPT — exemptions are IDs into `coverage-allowlist.ts` rows
  `{file, control, reason}`; stale/misplaced rows fail.
- 5 ACCEPT — T6 names the three files with line cites; SWEEPS §E updated.
- 6 ACCEPT — SWEEPS §E records `PayoutGallery.tsx` as dead; T6 decides.
- 7 ACCEPT — `section` required, normalised to `'general'` at build.

No rejections. Plan revised.

## Round 3 — Codex (fresh session)

VERDICT: REVISE. 6 findings.

1. (High) The dialog guard does not hold — many live modal shells have no
   `role="dialog"`/`aria-modal` (`BracketPoolDashboard.tsx:2182`,
   `Props/PropsManager.tsx:168`, `PlayoffDashboard.tsx:556`). Fix: modal
   stack / accessible modal primitive consulted by the shortcut.
2. (Medium) Always-mounted off-canvas `<aside role="dialog">` stays in the
   a11y tree and tab order when closed. Fix: unmount after transition, or
   `inert` + `aria-hidden` and drop dialog semantics while closed.
3. (High) Escape arbitration unsound — `stopPropagation` does not stop sibling
   document listeners; registration order loses. Fix: centralised Escape
   ownership (capture phase, `stopImmediatePropagation`).
4. (Medium) Sweep E counts only lowercase native controls;
   `SurvivorPickEntry.tsx:324` "Rebuy / Buy-Back" `<Button>` is a member
   option with no ticket. Fix: inventory semantic controls too.
5. (Medium) Static `short/long` cannot represent setting-dependent copy such
   as `survivorModeRulesCopy(pickLosersMode, tieCountsAs)`
   (`SurvivorPickEntry.tsx:150`). Fix: parameterised topic templates, or
   classify as non-help.
6. (Low) §8 glossary text says a Help Entry belongs to exactly one Help Page,
   contradicting D1's many-placement model. Fix: consistent Help Topic
   terminology.

### Claude's response

Verified: 41 `fixed inset-0` overlay shells in `src/` vs 6 `role="dialog"`;
the three cited lines are role-less backdrops; `utils/survivorRules.ts:13,25,
35,42` export four setting-dependent copy helpers and `recapHighlight.ts:54`
one more; re-running Sweep E with a semantic grep found exactly three
semantic-only files (SurvivorPickEntry, StandingsTable, PropLeaderboard).

- 1 ACCEPT — D3 now specifies an overlay stack (`useOverlayOwner`) with a
  DOM fallback selector; T2 registers the six accessible modals; new **T16**
  migrates the remaining ~35 shells (ordinary a11y ticket). Degraded (not
  broken) behaviour until T16 is stated.
- 2 ACCEPT — body unmounted after transition; `inert` + `aria-hidden`,
  role dropped while closed.
- 3 ACCEPT — same overlay stack owns Escape: one capture-phase listener,
  top-of-stack handles, `stopImmediatePropagation`.
- 4 ACCEPT — SWEEPS §E gains the semantic grep + three files; T7 rows.
- 5 ACCEPT — `HelpCopy = string | { template, fallback }`; the survivor /
  recap / tiebreaker helpers become topic templates and may not be called
  directly elsewhere (grep guard). §2e lists them.
- 6 ACCEPT — §8 rewritten: Help Topic / Help Page / Help Panel / Help Tip;
  "placed on one or more Help Pages".

No rejections. Plan revised.

## Round 4 — Codex (fresh session)

VERDICT: REVISE. 5 findings.

1. (High) T16 not required before T15, so 35 unregistered overlays still let
   `?` open Help over an active modal. Fix: make T16 a prerequisite, or
   register every overlay before enabling the shortcut.
2. (High) Wizard coverage claim false — `CreatePropsPool.tsx:45-58`
   (`register` prompt, `Controller` options) and `CreatePlayoffPool.tsx:30-31`
   (`register('lockDate')`) bypass `fields.tsx` and the `name=` grep. Fix:
   `helpId` on `Field`/`ReadOnlyField`; test all `register()`/`Controller`
   paths.
3. (Medium) `PayoutsPanel.tsx` keeps independent explanations
   (`PAYOUT_MODE_COPY`, `UNSOLD_LABELS`, Squares rule copy) and renders on
   rules pages and `/join`. Fix: add to T8 with a drift guard.
4. (Medium) Scoped resolution specified only for `HelpTip`; panel placements
   use exact ids, so tooltip and panel can disagree on a scoped variant. Fix:
   `placementsForPage` resolves through scope; parity test.
5. (Medium) Global panel cannot read route-local `HelpScope`; no base
   publisher for `PoolRoute`'s inline Squares `Grid`. Fix: publish pool
   type/audience/route params into the global provider from
   `PoolRoute`/`AdminRoute` for every dispatched type.

### Claude's response

Verified: `CreatePropsPool.tsx:46` `register(\`props.questions.${i}.text\`)`
inside `<Field label="Prompt">`, `:48-58` `<Controller name=…options>`;
`CreatePlayoffPool.tsx:30-31` `register('lockDate')`; `PayoutsPanel.tsx:32-51`
constants and importers `JoinPool.tsx:210`, `NFLPoolRules.tsx:304`,
`BracketRulesPanel.tsx:148`.

- 1 ACCEPT — fallback selector gains `.fixed.inset-0:not(#help-panel)`
  (the literal Tailwind pair on all 41 measured backdrops) so the interim IS
  covered, AND T16 is now a stated prerequisite of T15 (sequencing rules
  updated).
- 2 ACCEPT — D1 lists all six raw sites with lines; `Field`/`ReadOnlyField`
  gain `helpId`; the coverage grep covers five syntactic forms.
- 3 ACCEPT — §2e and T8 name `PayoutsPanel.tsx` with line cites; grep guard
  wording tightened.
- 4 ACCEPT — `placementsForPage` resolves via `resolveTopic(scope, id)`;
  parity test named.
- 5 ACCEPT — `HelpScope` moved to the App-level provider; `PoolRoute`/
  `AdminRoute` are the base publishers for every dispatched pool type
  including inline Squares; tab publishers refine.

No rejections. Plan revised. Round 5 is the last permitted by the task cap.

## Round 5 — Codex (fresh session) — final permitted round

VERDICT: REVISE. 3 findings.

1. (High) `useOverlayOwner` registering on mount would let `AuthModal` /
   `ShareModal` (mounted while closed behind `isOpen`) own the stack forever
   and suppress `?`. Fix: register only while `active`; test a mounted-closed
   modal.
2. (Medium) `FieldLabel` as "label containing HelpTip" nests a `<button>`
   inside a `<label>`. Fix: sibling row.
3. (Low) Lazy admin gate cites `isSuperAdmin` for SUPER_ADMIN/MODERATOR but
   `utils/auth.ts` returns true only for SUPER_ADMIN. Fix: gate as
   SUPER_ADMIN-only consistent with route access.

### Claude's response

Verified: `AuthModal.tsx:13-24` and `ShareModal.tsx:15-27` take an `isOpen`
prop and early-return null while mounted; `utils/auth.ts:16-18`
`isSuperAdmin` = `SUPER_ADMIN` only; `App.tsx:200,423` gates `/super-admin`
with it.

- 1 ACCEPT — `useOverlayOwner(id, { active, onEscape })`, push while active,
  test named.
- 2 ACCEPT — `FieldLabel` = flex row with `<label htmlFor>` + sibling HelpTip;
  `fields.tsx` `Field` uses the same row.
- 3 ACCEPT — gate = the `/super-admin` route's own predicate
  (`isSuperAdmin`, SUPER_ADMIN only); MODERATOR wording removed.

## Resolution — STOPPED AT CAP, ALL FINDINGS RESOLVED, NOT APPROVED

Five rounds ran (the task cap for this docs-only artifact); every round
returned REVISE and every finding across the five rounds (13 + 7 + 6 + 5 + 3
= 34) was verified against the code and ACCEPTED — zero rejections. The
round-5 fixes are absorbed into the plan but have NOT been reviewed by codex
(CLAUDE.md §2c: "new code written to close a finding earns its own round").
The trend is strongly convergent (13 → 7 → 6 → 5 → 3, and round 5's three
were all local wording/mechanism defects, none structural), so I stopped at
the cap rather than asking Kevin for more paid rounds. This is "cap reached,
all findings resolved, not approved" per `mmp-docs-and-writing` §2b — the
plan carries no open findings, but it does not carry a codex APPROVED
either. Kevin decides whether one more round is worth buying before signing
§6; my read of the diff is that it is not required for a plan whose next
step is his §6 sign-off, and that the T0 PR's own codex review will re-cover
the mechanism.
