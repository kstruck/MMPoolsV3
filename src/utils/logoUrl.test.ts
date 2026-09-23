import { describe, it, expect } from 'vitest';
import { resolveLogoUrl } from './logoUrl';

const ID = '1G8ijWWzJK6ePoRuhxeIgZAaiEZl09kQU';
const DIRECT = `https://lh3.googleusercontent.com/d/${ID}=w800`;

describe('resolveLogoUrl', () => {
    it('rewrites a Google Drive share link (the Donkeys 2026 case) to the image CDN', () => {
        expect(resolveLogoUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(DIRECT);
    });

    it('handles the other Drive link shapes', () => {
        expect(resolveLogoUrl(`https://drive.google.com/file/d/${ID}/view`)).toBe(DIRECT);
        expect(resolveLogoUrl(`https://drive.google.com/file/d/${ID}`)).toBe(DIRECT);
        expect(resolveLogoUrl(`https://drive.google.com/open?id=${ID}`)).toBe(DIRECT);
        expect(resolveLogoUrl(`https://drive.google.com/uc?export=view&id=${ID}`)).toBe(DIRECT);
        expect(resolveLogoUrl(`https://www.drive.google.com/file/d/${ID}/view`)).toBe(DIRECT);
    });

    it('leaves a Drive link with no recognisable id alone', () => {
        const folder = 'https://drive.google.com/drive/folders/abc';
        expect(resolveLogoUrl(folder)).toBe(folder);
    });

    it('rewrites a Dropbox preview link to raw', () => {
        expect(resolveLogoUrl('https://www.dropbox.com/s/abc/logo.png?dl=0'))
            .toBe('https://www.dropbox.com/s/abc/logo.png?raw=1');
    });

    it('passes ordinary image URLs through untouched', () => {
        const plain = 'https://example.com/logo.png';
        expect(resolveLogoUrl(plain)).toBe(plain);
        expect(resolveLogoUrl('/local/logo.svg')).toBe('/local/logo.svg');
        expect(resolveLogoUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    });

    it('returns undefined for empty input so `{url && <img>}` guards still work', () => {
        expect(resolveLogoUrl(undefined)).toBeUndefined();
        expect(resolveLogoUrl(null)).toBeUndefined();
        expect(resolveLogoUrl('')).toBeUndefined();
        expect(resolveLogoUrl('   ')).toBeUndefined();
    });

    it('trims surrounding whitespace', () => {
        expect(resolveLogoUrl('  https://example.com/logo.png ')).toBe('https://example.com/logo.png');
    });
});
