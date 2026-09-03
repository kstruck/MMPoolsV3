import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/** 2026-08-23 a11y audit — source pins (behavioral trap tests live in
 *  src/__tests__/useFocusTrap.test.tsx). */
const ROOT = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/**
 * Every `aria-modal` surface under `src/components/`, DISCOVERED rather than
 * listed (audit item 15a, closing pass).
 *
 * The hand-maintained array this replaced could only ever pin the surfaces
 * somebody remembered to add to it — and `QuickPicksDialog` is the proof that
 * the remembering fails: it declared `aria-modal` and trapped nothing, and the
 * green suite said the invariant held. A walker cannot be forgotten.
 *
 * ⚠️ COMMENTS ARE STRIPPED FIRST, so this finds files that DECLARE the
 * attribute rather than files that merely talk about it. Four of the eight
 * matches today are prose (`OverlayRoot` and `HelpPanel` explain the rule in
 * comments, and `QuickPicksDialog`'s own header quotes it); on a raw scan a file
 * that only *mentioned* `aria-modal` would be conscripted into the invariant and
 * would have to be given an exemption it does not need.
 */
const stripComments = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ariaModalComponents = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${e.name}`;
            if (e.isDirectory()) { walk(rel); continue; }
            if (!e.name.endsWith('.tsx') || e.name.endsWith('.test.tsx')) continue;
            if (stripComments(read(rel)).includes('aria-modal')) out.push(rel);
        }
    };
    walk('src/components');
    return out.sort();
})();

/**
 * Two surfaces carry `aria-modal` and do NOT call the shared hook. Both are
 * named here with the reason, so an exemption is a decision on the record
 * rather than an omission — and the assertions below fail if a reason stops
 * being true.
 */
const TRAP_EXEMPT: Record<string, string> = {
    // Has a trap, just not this one: an older inline implementation predating
    // the shared hook. Unifying them is a real cleanup and a separate change.
    'src/components/ui/OverlayRoot.tsx': 'carries its own inline wrap-around trap',
    // RESIDUAL, deliberately left: the confirm dialog is untrapped. Escape and
    // the backdrop close it and it focuses its own control, so it is the mildest
    // instance — but it IS an instance, and it is written down here rather than
    // being invisible.
    'src/components/ui/Toast.tsx': 'confirm dialog is untrapped — known residual',
};

describe('a11y source invariants', () => {
    it('the comment stripper keeps declarations and drops prose about them', () => {
        // Guard the stripper in both directions, on real files. If it ate JSX
        // the walker would return [] and every assertion below would pass
        // vacuously; if it left comments in place it would conscript files that
        // only discuss the attribute.
        expect(stripComments(read('src/components/modals/ShareModal.tsx')))
            .toContain('aria-modal="true"');
        expect(stripComments('  // a11y audit: aria-modal promises containment\n'))
            .not.toContain('aria-modal');
        expect(stripComments('/**\n * declares `aria-modal="true"`, so it owes containment\n */\n'))
            .not.toContain('aria-modal');
    });

    it('the aria-modal walker actually found the surfaces', () => {
        // Guard the guard: a walker that silently returns [] passes every
        // assertion below without reading a line of source.
        expect(ariaModalComponents).toContain('src/components/modals/AuthModal.tsx');
        expect(ariaModalComponents).toContain('src/components/help/HelpPanel.tsx');
        expect(ariaModalComponents)
            .toContain('src/components/NFLPoolDashboard/pickSheet/QuickPicksDialog.tsx');
        // A floor, not a census: naming three files above is the real guard,
        // and hard-coding today's exact count would fail the day a modal is
        // legitimately deleted.
        expect(ariaModalComponents.length).toBeGreaterThanOrEqual(6);
    });

    it('every aria-modal dialog component wires useFocusTrap', () => {
        for (const f of ariaModalComponents) {
            if (f in TRAP_EXEMPT) continue;
            const text = read(f);
            expect(text, `${f} must use useFocusTrap (or be listed in TRAP_EXEMPT with a reason)`)
                .toContain('useFocusTrap(');
        }
    });

    it('no exemption is stale — each still exists and still declares aria-modal', () => {
        for (const [f, why] of Object.entries(TRAP_EXEMPT)) {
            expect(ariaModalComponents, `${f} is exempt "${why}" but no longer an aria-modal surface`)
                .toContain(f);
        }
        // And the one exemption that claims to have a trap of its own must
        // still have it, or it is an untrapped modal wearing an excuse.
        expect(read('src/components/ui/OverlayRoot.tsx')).toContain("event.key !== 'Tab'");
    });

    it('the QuickPicks dialog traps unconditionally — it is mounted only while open', () => {
        // Behavioural proof: src/__tests__/quickPicksDialogFocusTrap.test.tsx.
        // `true`, not an `isOpen` prop, because the caller unmounts it to close;
        // a stale `isOpen` here would be a trap that never retracts.
        const text = read('src/components/NFLPoolDashboard/pickSheet/QuickPicksDialog.tsx');
        expect(text).toContain('useFocusTrap(dialogRef, true)');
        expect(text).toContain('ref={dialogRef}');
    });

    it('the HelpPanel trap is gated on the SAME condition as its aria-modal', () => {
        // Desktop renders a non-modal side drawer; trapping Tab there would
        // strand a keyboard reader in a panel the page never claimed to own.
        // Behavioural proof: src/__tests__/helpPanelFocusTrap.test.tsx.
        const text = read('src/components/help/HelpPanel.tsx');
        expect(text).toContain('aria-modal={isOpen && isMobile ? true : undefined}');
        expect(text).toContain('useFocusTrap(asideRef, isOpen && isMobile)');
    });

    it('failure banners are live regions (a screen reader hears the error)', () => {
        for (const [f, marker] of [
            ['src/components/Auth.tsx', 'bg-brandred-600/10'],
            ['src/components/ContactPage.tsx', 'bg-brandred-600/15'],
        ] as const) {
            const text = read(f);
            const idx = text.indexOf(marker);
            expect(idx, `${f} still renders its error banner`).toBeGreaterThan(-1);
            // role="alert" must be ON the banner element, not merely somewhere
            // in the file — check the attribute immediately precedes it.
            expect(
                text.slice(Math.max(0, idx - 120), idx),
                `${f} error banner needs role="alert"`,
            ).toContain('role="alert"');
        }
    });

    it('the liability checkboxes clear 24px and show a focus ring', () => {
        for (const f of [
            'src/components/Grid.tsx',
            'src/components/PlayoffPool/RankingForm.tsx',
            'src/components/Props/PropCardForm.tsx',
        ]) {
            const text = read(f);
            const idx = text.indexOf('checked={liabilityAccepted}');
            expect(idx, `${f} still renders the liability checkbox`).toBeGreaterThan(-1);
            const cls = text.slice(idx, idx + 600);
            // WCAG 2.2 SC 2.5.8: 24x24 CSS px. h-5 w-5 was 20px.
            expect(cls, `${f}: liability checkbox must be >= 24px (h-6 w-6)`).toContain('h-6 w-6');
            expect(cls, `${f}: liability checkbox needs a visible focus ring`)
                .toContain('focus-visible:ring-2');
        }
    });

    it('contact form labels are wired to their controls', () => {
        const text = read('src/components/ContactPage.tsx');
        for (const id of ['contact-name', 'contact-email', 'contact-subject', 'contact-message']) {
            expect(text).toContain(`htmlFor="${id}"`);
            expect(text).toContain(`id="${id}"`);
        }
    });

    it('header nav renders real links and Logo stays anchor-free (no nested <a>)', () => {
        const header = read('src/components/Header.tsx');
        expect(header).toMatch(/<a\s*\n?\s*href=\{to\}/);
        const logo = read('src/components/Logo.tsx');
        expect(logo).not.toContain('<a ');
    });

    it('eslint carries jsx-a11y', () => {
        expect(read('eslint.config.js')).toContain('eslint-plugin-jsx-a11y');
    });

    /**
     * 🛑 THE TOGGLE SWITCH HAS EXACTLY ONE HOME, AND IT IS `ui/Switch.tsx`.
     *
     * Five copies of it existed, each wrapping a `<label>` around nothing but the
     * visually-hidden checkbox and the decorative track. The words a sighted
     * person reads sat in a SIBLING heading, outside the label — so every one of
     * those controls announced as a bare "checkbox, unchecked" with no way to
     * tell WHICH setting was being toggled.
     *
     * DISCOVERED, NOT LISTED, for the reason the `aria-modal` walker above
     * gives: a hand-kept array can only pin the copies somebody remembered to
     * add to it, and a sixth copy pasted next week is exactly the case that
     * needs catching. The marker is the visually-hidden input (`sr-only peer`)
     * paired with the track's dimensions — together they are this widget and
     * nothing else, and neither alone would be.
     *
     * `Switch` takes a REQUIRED `label`, so a copy routed through it cannot be
     * nameless. Its own behaviour is pinned in `src/__tests__/switch.dom.test.tsx`.
     */
    const SWITCH_HOME = 'src/components/ui/Switch.tsx';

    /**
     * One toggle is a different widget and is deliberately NOT migrated: its
     * `<label>` carries visible text ("Send me SMS reminders"), so it is already
     * named, and folding it into `Switch` would either duplicate that text into
     * an `aria-label` or drop it from the page.
     *
     * Named here with the reason so the exemption is a decision on the record —
     * and the assertion below fails if the reason stops being true.
     */
    const SWITCH_EXEMPT: Record<string, string> = {
        'src/components/UserProfile.tsx':
            'Its label wraps visible text, so the control is already named. Different widget, not a copy of this one.',
    };

    const rollsOwnSwitch = (() => {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) { walk(rel); continue; }
                if (!e.name.endsWith('.tsx') || e.name.endsWith('.test.tsx')) continue;
                const src = stripComments(read(rel));
                if (src.includes('sr-only peer') && src.includes('w-11 h-6 bg-line')) out.push(rel);
            }
        };
        walk('src/components');
        return out.sort();
    })();

    it('no component re-rolls the toggle switch', () => {
        const offenders = rollsOwnSwitch.filter(
            (f) => f !== SWITCH_HOME && SWITCH_EXEMPT[f] === undefined,
        );
        expect(
            offenders,
            'these render their own switch instead of `ui/Switch` — a hand-rolled one has no accessible name',
        ).toEqual([]);
    });

    it('the walker actually finds the switch — it is not matching nothing', () => {
        // A discovery guard that discovers zero files passes for the wrong
        // reason. `Switch.tsx` itself must always be in the result.
        expect(rollsOwnSwitch).toContain(SWITCH_HOME);
    });

    it('no switch exemption is stale', () => {
        // An exemption for a file that no longer rolls its own is an exemption
        // nobody reviewed, and it hides the day that file grows one back.
        const stale = Object.keys(SWITCH_EXEMPT).filter((f) => !rollsOwnSwitch.includes(f));
        expect(stale).toEqual([]);
    });

    it('every migrated switch call site passes a label', () => {
        // `label` is required by the type, so this cannot fail while `tsc` is
        // green — which is the point: it pins that the four migrated files use
        // the component at all, so a revert to raw markup fails HERE with a
        // readable message rather than only in the walker above.
        for (const f of [
            'src/components/AdminPanel.tsx',
            'src/components/admin/WizardStepBasics.tsx',
            'src/components/admin/WizardStepPayouts.tsx',
            'src/components/admin/WizardStepSideHustle.tsx',
        ]) {
            const src = stripComments(read(f));
            const uses = src.match(/<Switch\b/g) ?? [];
            expect(uses.length, `${f} should render at least one <Switch>`).toBeGreaterThan(0);
            const labelled = src.match(/<Switch\b[\s\S]*?label=/g) ?? [];
            expect(labelled.length, `${f}: every <Switch> needs a label`).toBe(uses.length);
        }
    });
});

/**
 * 2026-09-03 motion audit (PR #669) — source pins for the three rules the
 * audit enforced: prefers-reduced-motion is honoured app-wide, hover states are
 * gated to hover-capable pointers, and no transition runs on a layout property.
 *
 * These are static invariants on purpose. A behavioral test would need a
 * browser that honours media queries; jsdom does not, so a render-and-assert
 * test here would pass with the rules deleted. What CAN regress silently is
 * the source: someone re-adds `transition-all` (350 sites were removed), drops
 * the Tailwind `future` flag, or un-wraps `MotionConfig` — and each of those is
 * exactly one grep away from being caught.
 */
const walkSrc = (pred: (name: string) => boolean): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${e.name}`;
            if (e.isDirectory()) { walk(rel); continue; }
            if (pred(e.name)) out.push(rel);
        }
    };
    walk('src');
    return out.sort();
};
const isUiSource = (n: string) =>
    (n.endsWith('.tsx') || n.endsWith('.ts') || n.endsWith('.css')) && !/\.test\.tsx?$/.test(n);

describe('motion a11y invariants', () => {
    it('index.css carries a reduced-motion block that neuters animation and transform on every element', () => {
        const css = stripComments(read('src/index.css'));
        const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
        expect(block, 'no @media (prefers-reduced-motion: reduce) block in src/index.css').not.toBeNull();
        const body = block![1];
        // The allowlist must sit on `*`, not on named Tailwind classes — codex r1
        // on #669: arbitrary `transition-[…]` utilities escaped a class-scoped rule.
        expect(body).toMatch(/\*,\s*::before,\s*::after\s*\{[^}]*animation-duration:\s*0\.01ms\s*!important/);
        expect(body).toMatch(/\*,\s*::before,\s*::after\s*\{[^}]*transition-property:[^;]*opacity[^;]*!important/);
        expect(body, 'transform must NOT be in the reduced-motion transition allowlist').not.toMatch(/transition-property:[^;]*\btransform\b/);
    });

    it('framer-motion is wrapped in MotionConfig reducedMotion="user" at the root', () => {
        const main = stripComments(read('src/main.tsx'));
        expect(main).toMatch(/import \{ MotionConfig \} from 'framer-motion'/);
        expect(main).toMatch(/<MotionConfig reducedMotion="user">[\s\S]*<App \/>[\s\S]*<\/MotionConfig>/);
    });

    it('Tailwind gates every hover: variant behind @media (hover: hover)', () => {
        const cfg = stripComments(read('tailwind.config.js'));
        expect(cfg).toMatch(/future:\s*\{[^}]*hoverOnlyWhenSupported:\s*true/);
    });

    it('hover-revealed controls have a no-hover and a keyboard path', () => {
        const css = stripComments(read('src/index.css'));
        // The CSS source spells the Tailwind class as `.group-hover\:opacity-100`
        // (escaped colon), so the pattern needs a literal backslash before the colon.
        expect(css).toMatch(/@media \(hover: none\)\s*\{[\s\S]*?\.group-hover\\:opacity-100[\s\S]*?opacity:\s*1/);
        expect(css).toMatch(/\.group:focus-within \.group-hover\\:opacity-100/);
    });

    it('no source file uses transition-all (Tailwind `transition` excludes layout properties)', () => {
        const offenders = walkSrc(isUiSource).filter(f => /\btransition-all\b/.test(stripComments(read(f))));
        expect(offenders, 'transition-all animates width/height/margin/padding — use `transition` or a specific utility').toEqual([]);
    });

    it('no arbitrary transition utility names a layout property', () => {
        const LAYOUT = /transition-\[[^\]]*\b(width|height|max-height|max-width|min-height|min-width|top|left|right|bottom|inset|margin|padding|gap|grid-template-rows|grid-template-columns)\b/;
        const offenders = walkSrc(isUiSource).filter(f => LAYOUT.test(stripComments(read(f))));
        expect(offenders).toEqual([]);
    });

    it('no progress bar animates an inline width — fills use scaleX + origin-left', () => {
        // qodo #669 finding 10: bars that kept `style={{ width }}` and swapped
        // transition-all → transition silently STOPPED animating (width is not in
        // the default list). Either transform the fill or do not transition it.
        const offenders: string[] = [];
        for (const f of walkSrc(n => n.endsWith('.tsx') && !/\.test\.tsx$/.test(n))) {
            const src = stripComments(read(f));
            const re = /style=\{\{\s*width:/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(src))) {
                const tagStart = src.lastIndexOf('<', m.index);
                const opening = src.slice(tagStart, m.index);
                if (/\btransition\b(?!-)/.test(opening) || /transition-\[width/.test(opening)) {
                    offenders.push(`${f}@${src.slice(0, m.index).split('\n').length}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
