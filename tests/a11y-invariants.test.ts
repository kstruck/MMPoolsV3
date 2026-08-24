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
        ]) {
            const text = read(f);
            expect(text, `${f} declares aria-modal`).toContain('aria-modal');
            expect(text, `${f} must use useFocusTrap`).toContain('useFocusTrap(');
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
