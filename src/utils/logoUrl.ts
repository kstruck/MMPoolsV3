/**
 * Turn a "share" link into something an `<img src>` can actually load.
 *
 * Commissioners paste whatever their file host hands them. For Google Drive
 * that is `https://drive.google.com/file/d/<ID>/view?usp=sharing`, which is an
 * HTML viewer page, not an image — the browser fetches it, gets `text/html`,
 * and renders the broken-image glyph with the alt text. Measured 2026-09-02 on
 * pool `ubHD4bgszL05oURYubrn` ("Donkeys 2026"): the share link answered
 * `200 text/html`, while `https://lh3.googleusercontent.com/d/<ID>` answered
 * `200 image/png` for the same file.
 *
 * This is applied at RENDER time, not at save time, so every pool that already
 * stored a share link is fixed without a data migration, and the commissioner's
 * settings form still shows exactly what they pasted.
 *
 * Anything we do not recognise is returned untouched.
 */

/** `/file/d/<ID>/…` and `/open?id=<ID>` and `/uc?…id=<ID>` forms. */
const DRIVE_HOST = /^(?:www\.)?drive\.google\.com$/i;
const DRIVE_FILE_PATH = /^\/file\/d\/([\w-]+)/;

/**
 * Drive's image CDN. Serves the file bytes with the real content-type and
 * honours `=w<px>` size hints. A 48px header logo does not need the 2.4 MB
 * original; `=w800` brought the Donkeys logo down to ~700 KB, and the hint is
 * ignored (full size served) for hosts that do not understand it.
 */
const DRIVE_IMAGE_WIDTH = 800;

const dropboxToDirect = (url: URL): string | null => {
    // Dropbox `?dl=0` is a preview page; `raw=1` serves the bytes.
    if (!/^(?:www\.)?dropbox\.com$/i.test(url.hostname)) return null;
    url.searchParams.delete('dl');
    url.searchParams.set('raw', '1');
    return url.toString();
};

const driveToDirect = (url: URL): string | null => {
    if (!DRIVE_HOST.test(url.hostname)) return null;
    const fromPath = DRIVE_FILE_PATH.exec(url.pathname)?.[1];
    const fromQuery = url.searchParams.get('id');
    const id = fromPath ?? fromQuery;
    if (!id || !/^[\w-]+$/.test(id)) return null;
    return `https://lh3.googleusercontent.com/d/${id}=w${DRIVE_IMAGE_WIDTH}`;
};

/**
 * Resolve a stored logo URL to one an `<img>` can load. Returns the input
 * unchanged when it is empty, not a URL, or from a host we have no rule for.
 */
export function resolveLogoUrl(raw: string | undefined | null): string | undefined {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return trimmed;
    }
    return driveToDirect(url) ?? dropboxToDirect(url) ?? trimmed;
}
