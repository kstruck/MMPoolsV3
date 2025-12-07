import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser
} from "firebase/auth";
import { auth } from "../firebase";
import type { User } from "../types";

const googleProvider = new GoogleAuthProvider();

// Map Firebase User to our App User type
const mapUser = (firebaseUser: FirebaseUser | null): User | null => {
  if (!firebaseUser) return null;
  return {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || "Unknown User",
    email: firebaseUser.email || "",
    picture: firebaseUser.photoURL || undefined
  };
};

export const authService = {
  // Get current user synchronously (might be null on initial load before auth check completes)
  getCurrentUser: (): User | null => {
    return mapUser(auth.currentUser);
  },

  // Login with Google
  loginWithGoogle: async (): Promise<User | null> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return mapUser(result.user);
    } catch (error) {
      console.error("Google Sign-In Error", error);
      throw error;
    }
  },

  // Logout
  logout: async () => {
    try {
      await signOut(auth);
      window.location.reload(); // Refresh to clear app state
    } catch (error) {
      console.error("Logout Error", error);
    }
  },

  // Mock methods for backward compatibility (optional, can be removed if unused)
  register: async (_name: string, _email: string, _password: string): Promise<User> => {
    throw new Error("Use Google Login");
  },
  login: async (email: string, _password?: string): Promise<User> => {
    // Handle Demo Login specifically
    if (email === 'admin@test.com') {
      // Create a fake session for demo purposes
      const demoUser: User = { id: 'demo_admin', name: 'Demo Admin', email: 'admin@test.com' };
      localStorage.setItem('sbSquaresUser', JSON.stringify(demoUser));
      return demoUser;
    }
    throw new Error("Use Google Login");
  },

  // Listener for Auth State
  onAuthStateChanged: (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, (firebaseUser) => {
      // Check for Demo User override first
      const demoUser = localStorage.getItem('sbSquaresUser');
      if (demoUser && !firebaseUser) {
        callback(JSON.parse(demoUser));
      } else {
        callback(mapUser(firebaseUser));
      }
    });
  }
};