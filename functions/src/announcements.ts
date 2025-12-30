import * as functions from "firebase-functions/v1";
import * as admin from 'firebase-admin';
import { Announcement, GameState } from './types';

/**
 * Triggered when a new announcement is added to a pool.
 * Sends an email to all participants.
 */
export const onAnnouncementCreated = functions.firestore
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

        // Add square owners (if they have email in playerDetails)
        pool.squares.forEach(sq => {
            if (sq.playerDetails?.email) {
                emails.add(sq.playerDetails.email);
            }
        });

        // Add registered users who are participants (if needed, query users collection? 
        // For now, rely on what's in the pool squares/playerDetails as that's the source of truth for "active" players)

        // 2. Prepare Email
        // Using the "Trigger Email" extension collection 'mail' is standard
        // Or if using a custom implementation. Assuming 'mail' collection based on typical Firebase setup.

        const recipientList = Array.from(emails);
        console.log(`Sending announcement to ${recipientList.length} recipients`);

        if (recipientList.length === 0) return;

        const emailPromises = recipientList.map(email => {
            return db.collection('mail').add({
                to: email,
                message: {
                    subject: `[${pool.name}] ${announcement.subject}`,
                    html: `
                        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
                            <h2 style="color: #4f46e5; margin-bottom: 10px;">${pool.name}</h2>
                            <h4 style="color: #333; margin-top: 0;">New Announcement</h4>
                            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                            
                            <div style="color: #444; font-size: 16px; line-height: 1.6; white-space: pre-wrap;">
                                ${announcement.message}
                            </div>
                            
                            <div style="margin-top: 30px; font-size: 12px; color: #888; text-align: center;">
                                <a href="https://marchmeleepools.web.app/pool/${pool.id}" style="color: #4f46e5; text-decoration: none;">View Pool</a>
                            </div>
                        </div>
                    `,
                }
            });
        });

        await Promise.all(emailPromises);
        console.log(`Emails queued for announcement ${announcement.id}`);
    });
