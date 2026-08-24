import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T1 (Kevin's issue 1, Kevin's D4 condition:
 * branding rendering must be READY FOR MONDAY).
 *
 * The rule is unit-tested in `src/utils/brandingStyles.test.ts`. What cannot be
 * reached from there is that the dashboard actually PAINTS with it — which is
 * precisely what was missing: `primaryColor` had no renderer anywhere in `src/`.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const dash = read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
const checklist = read('src/components/NFLPoolDashboard/WeekChecklist.tsx');
const step = read('src/components/wizard/steps/StepBranding.tsx');
const fields = read('src/components/wizard/fields.tsx');

describe('the NFL dashboard paints with the pool\u2019s colours', () => {
    it('resolves them through the shared helper, not inline reads', () => {
        expect(dash).toContain('const brand = brandingStyles(branding);');
    });

    it('the page background is no longer bgColor-only', () => {
        // `bgColor` is a field NO wizard collects, so this was the whole of the
        // page-level theming and it could never fire for a wizard-made pool.
        expect(dash).not.toContain('style={{ backgroundColor: branding.bgColor || undefined }}');
        expect(dash).toContain('style={brand.page}');
    });

    it('the pool header card carries the primary colour', () => {
        expect(dash).toContain('style={brand.headerCard}');
    });

    it('primary action buttons carry it too', () => {
        expect(dash).toContain('style={brand.primaryButton}');
        expect(dash).toContain('primaryButtonStyle={brand.primaryButton}');
        expect(checklist).toContain('style={primaryButtonStyle}');
    });

    it('the branded HEADER BAND is painted, and only when there is a colour', () => {
        // Kevin's 2026-08-24 decision (option ii): the band is what makes
        // branding visible. It is theme-safe because it owns both of its own
        // colours — `brand.headerBand` carries backgroundColor AND color.
        expect(dash).toContain('style={brand.headerBand}');
        expect(dash).toContain('style={brand.headerBandMuted}');
        expect(dash).toContain('{brand.themed && (');
    });

    it('an unbranded pool still gets its logo and name, in the old place', () => {
        // The band replaces the header's top row rather than sitting above it,
        // so a pool with no primary needs the original block back or the name
        // disappears entirely.
        expect(dash).toContain('{!brand.themed && (');
    });

    it('BOTH previews render the band, or one of them lies (codex)', () => {
        // The previews exist to promise the look the pool will actually have.
        // A bordered header in the preview and a solid band on the pool page is
        // the exact drift they were built to prevent.
        const editor = read('src/components/NFLPoolDashboard/NFLBrandingSettings.tsx');
        for (const src of [step, editor]) {
            expect(src).toContain('style={brand.headerBand}');
            expect(src).toContain('{brand.themed && (');
            // ...and the card has to clip it, same as the real header.
            expect(src).toContain('overflow-hidden rounded-lg');
        }
    });

    it('the card clips the band to its rounded corners', () => {
        // Without `overflow-hidden` the colour squares off the top corners.
        expect(dash).toContain('className="bg-card border border-line rounded-xl shadow-card overflow-hidden"');
    });

    it('the active-tab underline still uses the accent', () => {
        expect(dash).toContain('const accentHex = brand.accent;');
        expect(dash).toContain('borderBottomColor: accentHex');
    });
});

describe('the wizard explains and validates the colours', () => {
    it('the labels say what each colour does', () => {
        expect(step).toContain('Primary color — header & buttons');
        expect(step).toContain('Accent color — highlights & active tabs');
    });

    it('each colour has a picker AND a hex box bound to one value', () => {
        expect(step.match(/<ColorField/g)?.length).toBe(2);
        expect(fields).toContain('export function ColorField');
        expect(fields).toContain('type="color"');
    });

    it('an invalid hex is called out instead of silently styling nothing', () => {
        expect(fields).toContain('Use a hex colour like');
        expect(fields).toContain('const valid = isValidHex(current);');
    });

    it('the swatch never writes its own fallback into the form', () => {
        // `<input type="color">` shows #000000 for anything it cannot parse, so
        // reading it as the value would turn "no colour chosen" into "black".
        expect(fields).toContain('const swatch = valid ? normalizeHex(current)! : fallback;');
        expect(fields).toContain('value={swatch}');
    });

    it('the effect-named labels and the preview are NFL-only (codex r1 [P2])', () => {
        // StepBranding is shared by all seven wizards, but only the NFL
        // dashboards paint with the colours (D4 scoped it there for Monday).
        // Elsewhere the preview would promise a look the pool will not have.
        expect(step).toContain('themedDashboard = false');
        expect(step).toContain("themedDashboard ? 'Primary color — header & buttons' : 'Primary color'");
        expect(step).toContain('{themedDashboard ? (');
        expect(step).toContain('export function StepBrandingThemed()');
        for (const wizard of ['CreateNFLPickemPool', 'CreateNFLMarginPool', 'CreateNFLSurvivorPool']) {
            expect(read(`src/components/wizard/create/${wizard}.tsx`), wizard)
                .toContain('Component: StepBrandingThemed');
        }
        for (const wizard of ['CreateBracketPool', 'CreatePropsPool', 'CreateSquaresPool', 'CreatePlayoffPool']) {
            expect(read(`src/components/wizard/create/${wizard}.tsx`), wizard)
                .toContain('Component: StepBranding }');
        }
    });

    it('the themed variant is a NAMED component, not an inline arrow', () => {
        // The wizard shell keys steps by component identity; a new function each
        // render would remount the step and drop focus mid-typing.
        expect(step).not.toMatch(/Component: \(\) => <StepBranding/);
    });

    it('the preview is built from the SAME helper the pool page uses', () => {
        // A hand-drawn mock-up would be a second implementation, free to promise
        // a look the pool will not have.
        expect(step).toContain('const brand = brandingStyles(branding);');
        expect(step).toContain('style={brand.headerCard}');
        expect(step).toContain('style={brand.activeTabUnderline}');
    });
});
