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
});
