import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  type User as FirebaseUser
} from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, getDoc, setDoc, updateDoc, increment } from "firebase/firestore";
import type { User } from "../types";
import { emailService } from "./emailService";

const googleProvider = new GoogleAuthProvider();

const REFERRAL_STORAGE_KEY = 'march_melee_ref';

// Map Firebase User to our App User type
const mapUser = (firebaseUser: FirebaseUser | null): User | null => {
  if (!firebaseUser) return null;

  let method: 'google' | 'email' | 'unknown' = 'unknown';
  if (firebaseUser.providerData.length > 0) {
    const providerId = firebaseUser.providerData[0].providerId;
    if (providerId === 'google.com') method = 'google';
    else if (providerId === 'password') method = 'email';
  }

  return {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || "Unknown User",
    email: firebaseUser.email || "",
    picture: firebaseUser.photoURL || undefined,
    registrationMethod: method,
    role: 'PARTICIPANT', // Default, will be overwritten by Firestore data if exists
    provider: method === 'email' ? 'password' : 'google',
    referralCode: firebaseUser.uid, // Use UID as referral code
    emailVerified: firebaseUser.emailVerified
  };
};

// Sync user to Firestore 'users' collection
const syncUserToFirestore = async (user: User): Promise<User> => {
  const userRef = doc(db, 'users', user.id);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    // NEW USER - Create document
    const referredBy = localStorage.getItem(REFERRAL_STORAGE_KEY);

    const newUserData: any = {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture || null,
      registrationMethod: user.registrationMethod,
      referralCode: user.id,
      referralCount: 0,
      createdAt: Date.now(),
      role: user.role,
      provider: user.provider
    };

    if (referredBy && referredBy !== user.id) {
      newUserData.referredBy = referredBy;
      // Increment referrer's count
      try {
        const referrerRef = doc(db, 'users', referredBy);
        await updateDoc(referrerRef, { referralCount: increment(1) });
      } catch (e) {
        console.warn('Could not increment referrer count:', e);
      }
    }

    await setDoc(userRef, newUserData);
    localStorage.removeItem(REFERRAL_STORAGE_KEY); // Clear after use

    // NEW USER: If Google user (auto-verified), send welcome email immediately
    if (user.emailVerified) {
      // We can treat this as "verified"
      await emailService.sendWelcomeEmail(user.email, user.name, user.id);
      await updateDoc(userRef, { welcomeEmailSent: true });
      newUserData.welcomeEmailSent = true;
    }

    return { ...user, ...newUserData };
  } else {
    // EXISTING USER - Merge updates (name, picture)
    const existingData = userSnap.data() as User;

    // Check for Verification Event
    let welcomeSent = existingData.welcomeEmailSent;
    if (user.emailVerified && !welcomeSent) {
      console.log("User verified! Sending welcome email...");
      await emailService.sendWelcomeEmail(user.email, user.name || existingData.name, user.id);
      welcomeSent = true;
    }

    await setDoc(userRef, {
      name: user.name,
      picture: user.picture || null,
      emailVerified: user.emailVerified, // Sync Verification Status
      welcomeEmailSent: welcomeSent || false
    }, { merge: true });

    return {
      ...existingData,
      name: user.name,
      picture: user.picture,
      role: existingData.role || 'PARTICIPANT',
      provider: existingData.provider || 'password',
      emailVerified: user.emailVerified,
      welcomeEmailSent: welcomeSent
    };
  }
};

export const authService = {
  // Get current user synchronously
  getCurrentUser: (): User | null => {
    return mapUser(auth.currentUser);
  },

  // Get user data from Firestore (for referral stats)
  getUserData: async (uid: string): Promise<User | null> => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        return userSnap.data() as User;
      }
      return null;
    } catch (e) {
      console.error('Error fetching user data:', e);
      return null;
    }
  },

  // Login with Google
  loginWithGoogle: async (): Promise<User | null> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = mapUser(result.user);
      if (user) {
        return await syncUserToFirestore(user);
      }
      return null;
    } catch (error: any) {
      console.error("Google Sign-In Popup Error", error);
      // Fallback to redirect if popup is blocked or closed
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/popup-blocked') {
        const { signInWithRedirect } = await import('firebase/auth');
        await signInWithRedirect(auth, googleProvider);
        return null; // The page will redirect
      }
      throw error;
    }
  },

  // Register with Email/Password
  register: async (name: string, email: string, password: string): Promise<User> => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      // Update the user profile with their name
      await updateProfile(result.user, { displayName: name });

      // Send Verification Email
      await authService.sendVerificationEmail(result.user);

      const user = mapUser({ ...result.user, displayName: name }) as User;
      return await syncUserToFirestore(user);
    } catch (error) {
      console.error("Registration Error", error);
      throw error;
    }
  },

  sendVerificationEmail: async (user: any) => {
    try {
      const { sendEmailVerification } = await import('firebase/auth');
      await sendEmailVerification(user);
    } catch (e) {
      console.error("Error sending verification email:", e);
    }
  },

  // Login with Email/Password
  login: async (email: string, password?: string): Promise<User> => {
    // Handle Demo Login specifically for testing
    if (email === 'admin@test.com' && password === 'password') {
      const demoUser: User = { id: 'demo_admin', name: 'Demo Admin', email: 'admin@test.com', role: 'SUPER_ADMIN', provider: 'password', registrationMethod: 'email' };
      localStorage.setItem('sbSquaresUser', JSON.stringify(demoUser));
      return demoUser;
    }

    if (!password) throw new Error("Password required");

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = mapUser(result.user) as User;
      return await syncUserToFirestore(user);
    } catch (error) {
      console.error("Login Error", error);
      throw error;
    }
  },

  // Reset Password
  resetPassword: async (email: string): Promise<void> => {
    console.log(`[AuthService] Attempting to send reset password email to: ${email}`);
    try {
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, email);
      console.log(`[AuthService] Reset password email sent successfully to: ${email}`);
    } catch (error) {
      console.error("[AuthService] Reset Password Error", error);
      throw error;
    }
  },

  // Logout
  logout: async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('sbSquaresUser'); // Clear demo user if any
      window.location.reload();
    } catch (error) {
      console.error("Logout Error", error);
    }
  },

  // Listener for Auth State
  onAuthStateChanged: (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      const demoUser = localStorage.getItem('sbSquaresUser');
      if (demoUser && !firebaseUser) {
        callback(JSON.parse(demoUser));
      } else if (firebaseUser) {
        const user = mapUser(firebaseUser);
        if (user) {
          // Sync to Firestore (will create if new)
          try {
            const syncedUser = await syncUserToFirestore(user);
            callback(syncedUser);
          } catch (err) {
            console.error("Auth Sync Failed", err);
            // Fallback: Proceed with basic user data so they aren't stuck "logged out"
            callback(user);
          }
        } else {
          callback(null);
        }
      } else {
        callback(null);
      }
    });
  },

  // Update Profile (Name/Photo)
  updateProfile: async (name: string, photoURL?: string) => {
    try {
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName: name,
          photoURL: photoURL
        });
        // Also update Firestore
        const userRef = doc(db, 'users', auth.currentUser.uid);
        await setDoc(userRef, { name, picture: photoURL || null }, { merge: true });
      }
    } catch (error) {
      console.error("Update Profile Error", error);
      throw error;
    }
  },

  // Store referral code from URL
  storeReferralCode: (code: string) => {
    if (code) {
      localStorage.setItem(REFERRAL_STORAGE_KEY, code);
    }
  },

  syncUserToFirestore: syncUserToFirestore
};