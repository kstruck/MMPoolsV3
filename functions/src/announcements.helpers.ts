// Pure, dependency-light helper for the announcement email. Kept out of
// announcements.ts (which pulls in reminders/squarePrivate/firebase-admin) so
// it can be unit-tested without mocking any internal module — same split as
// joinPreview.helpers.ts. (qodo on #671.)
import { escapeHtml } from "./emailStyles";

/**
 * Announcement email body. Both inputs are text typed by a commissioner and
 * written to Firestore straight from the client (`AnnouncementManager.tsx`
 * `addDoc`, no server hop), so they are escaped here. `white-space: pre-wrap`
 * keeps the commissioner's line breaks without needing `<br>` markup.
 */
export const buildAnnouncementBody = (poolName: string, message: string): string => `
            <p style="font-size: 14px; color: #64748b; margin-bottom: 5px;">From: <strong>${escapeHtml(poolName)}</strong></p>
            <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 4px; margin: 20px 0;">
                <div style="color: #334155; font-size: 16px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</div>
            </div>
        `;
