import { db } from '../firebase';
import { doc, setDoc, collection, query, where, onSnapshot } from 'firebase/firestore';

export const referralService = {
  // Generate a unique referral link for a user
  generateReferralLink(userId: string): string {
    const baseUrl = window.location.origin;
    const token = btoa(userId).replace(/=/g, ''); // Base64 encode user ID
    return `${baseUrl}/#/?ref=${token}`;
  },

  // Parse referral token from URL back to userId
  parseReferralToken(token: string): string | null {
    try {
      // Pad base64 string back
      const padded = token + '='.repeat((4 - token.length % 4) % 4);
      return atob(padded);
    } catch {
      return null;
    }
  },

  // Store a referral record when a new user signs up via referral link
  async createReferralRecord(referrerId: string, newUserId: string): Promise<void> {
    const recordRef = doc(collection(db, 'referrals'));
    await setDoc(recordRef, {
      referrerId,
      referredUserId: newUserId,
      status: 'pending',
      createdAt: Date.now(),
      creditAwarded: false
    });
  },

  // Get referral stats for a user (for display in profile)
  subscribeToReferralStats(userId: string, callback: (stats: {
    totalReferred: number;
    confirmedReferred: number;
    pendingReferred: number;
    creditsEarned: number;
  }) => void): () => void {
    const q = query(collection(db, 'referrals'), where('referrerId', '==', userId));
    return onSnapshot(q, (snap) => {
      const records = snap.docs.map(d => d.data());
      callback({
        totalReferred: records.length,
        confirmedReferred: records.filter(r => r.status === 'confirmed').length,
        pendingReferred: records.filter(r => r.status === 'pending').length,
        creditsEarned: records.filter(r => r.creditAwarded).length
      });
    });
  }
};
