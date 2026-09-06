import * as functions from "firebase-functions/v1";
import * as admin from 'firebase-admin';
import { Announcement, GameState } from './types';
import { renderEmailHtml, escapeHtml, BASE_URL } from './emailStyles';
import { getSquareEmails } from './squarePrivate';
import { sendEmail } from './reminders';

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

/**
 * Triggered when a new announcement is added to a pool.
 * Sends an email to all participants.
 */
// v1 trigger — setGlobalOptions (v2) does not reach it; cap instances inline.
export const onAnnouncementCreated = functions.runWith({ maxInstances: 10 }).firestore
    .document('pools/{poolId}/announcements/{announcementId}')
    .onCreate(async (snap: functions.firestore.QueryDocumentSnapshot, context: functions.EventContext) => {
        const poolId = context.params.poolId;
        const announcement = snap.data() as Announcement;

        console.log(`New announcement in pool ${poolId}: ${announcement.subject}`);

        const db = admin.firestore();
        const poolRef = db.collection('pools').doc(poolId);
        const poolSnap = await poolRef.get();

        if (!poolSnap.exists) {
            console.error(`Pool ${poolId} not found`);
            return;
        }

        const pool = poolSnap.data() as GameState;

        // 1. Get unique recipients
        const emails = new Set<string>();

        // Add owner
        if (pool.contactEmail) emails.add(pool.contactEmail);

        // Add square owners — PII now lives in the restricted squarePrivate subcollection.
        const squareEmails = await getSquareEmails(db, poolId);
        squareEmails.forEach(e => emails.add(e));

        // Add registered users who are participants (if needed, query users collection? 
        // For now, rely on what's in the pool squares/playerDetails as that's the source of truth for "active" players)

        // 2. Prepare Email using standard template
        const recipientList = Array.from(emails);
        console.log(`Sending announcement to ${recipientList.length} recipients`);

        if (recipientList.length === 0) return;

        const emailHtml = renderEmailHtml(
            announcement.subject, // escaped inside renderEmailHtml
            buildAnnouncementBody(pool.name, announcement.message),
            `${BASE_URL}/pool/${pool.id}`,
            'View Pool'
        );

        const emailPromises = recipientList.map(email => {
            return sendEmail(db, email, `[${pool.name}] ${announcement.subject}`, emailHtml);
        });

        await Promise.all(emailPromises);
        console.log(`Emails queued for announcement ${announcement.id}`);
    });
