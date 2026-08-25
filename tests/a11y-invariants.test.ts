import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/** 2026-08-23 a11y audit — source pins (behavioral trap tests live in
 *  src/__tests__/useFocusTrap.test.tsx). */
const ROOT = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('a11y source invariants', () => {
    it('every aria-modal dialog component wires useFocusTrap', () => {
        for (const f of [
            'src/components/modals/AuthModal.tsx',
            'src/components/modals/PlayoffSettingsModal.tsx',
            'src/components/admin/ConfirmActionModal.tsx',
            // Audit item 15a — the residual aria-modal surfaces.
            'src/components/modals/ShareModal.tsx',
            'src/components/help/HelpPanel.tsx',
        ]) {
            const text = read(f);
            expect(text, `${f} declares aria-modal`).toContain('aria-modal');
            expect(text, `${f} must use useFocusTrap`).toContain('useFocusTrap(');
        }
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
