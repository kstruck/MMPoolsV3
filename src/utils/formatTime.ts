/**
 * Deadline/time formatting with explicit timezone labels.
 * Every user-facing deadline must render through these helpers so a member in PT
 * and a commissioner in ET can never read the same timestamp two different ways.
 */

/** "Sun, Sep 13 · 1:00 PM PDT" — full deadline with the viewer's zone labeled. */
export function formatDeadline(ts: number): string {
    const d = new Date(ts);
    const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return `${date} · ${time}`;
}

/** "1:00 PM PDT" — time only, zone labeled. */
export function formatTimeWithZone(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Viewer's IANA zone, e.g. "America/Los_Angeles" — for copy like "shown in your timezone". */
export function viewerZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
