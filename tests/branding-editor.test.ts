import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isGroupEditable, classifyUpdateKey } from '@shared/editability';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T8 — the commissioner can edit branding after the
 * wizard. Before this, the wizard's branding step was the ONLY writer: a
 * commissioner who typed the wrong hex, or wanted a logo later, had to
 * recreate the pool.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const editor = read('src/components/NFLPoolDashboard/NFLBrandingSettings.tsx');
const manager = read('src/components/NFLPoolDashboard/NFLManagerView.tsx');

describe('the server already allows it — the plan asked, this answers', () => {
    it('branding is editable in EVERY phase, not just pre-season', () => {
        // This is what makes the editor's placement correct: it is deliberately
        // OUTSIDE `canEditSettings` (super admin OR pre-season), which exists to
        // freeze pool RULES once the season runs. Branding is not a rule.
        for (const phase of ['draft', 'open', 'locked', 'archived'] as const) {
            expect(isGroupEditable(phase, 'branding'), phase).toBe(true);
        }
        // ...and a `branding` update key actually classifies into that group,
        // which is the other half of the callable admitting it.
        expect(classifyUpdateKey('branding')).toBe('branding');
    });
});

describe('the editor', () => {
    it('saves through the pool-update callable, not a client-direct write', () => {
        // firestore.rules denies a client-direct settings write on NFL pools.
        expect(editor).toContain('dbService.updatePoolSettings(pool.id, {');
        expect(editor).toContain('branding: {');
    });

    it('is mounted outside the season-locked settings gate', () => {
        expect(manager).toContain("{commishTab === 'settings' && <NFLBrandingSettings pool={pool} />}");
        // If this ever moves inside the gated form, the assertion above breaks
        // and this comment explains why that is a regression, not a tidy-up.
        expect(manager).not.toMatch(/canEditSettings[\s\S]{0,200}?<NFLBrandingSettings/);
    });

    it('validates hex the same way the wizard does', () => {
        expect(editor).toContain('const valid = isValidHex(trimmed);');
        expect(editor).toContain('Use a hex colour like');
    });

    it('never writes the colour picker\u2019s fallback into the stored value', () => {
        // `<input type="color">` shows #000000 for anything it cannot parse, so
        // reading it as the value would turn "no colour chosen" into "black".
        expect(editor).toContain('const swatch = valid ? normalizeHex(trimmed)! : fallback;');
        expect(editor).toContain('value={swatch}');
    });

    it('previews with the SAME helper the pool page paints with', () => {
        // A hand-drawn preview would be free to promise a look the pool will
        // not have.
        expect(editor).toContain('brandingStyles({ logoUrl, primaryColor, secondaryColor })');
        expect(editor).toContain('style={brand.headerCard}');
        expect(editor).toContain('style={brand.primaryButton}');
        expect(editor).toContain('style={brand.activeTabUnderline}');
    });
});
