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
import { auth } from "../firebase";
import type { User } from "../types";

const googleProvider = new GoogleAuthProvider();

// Map Firebase User to our App User type
const mapUser = (firebaseUser: FirebaseUser | null): User | null => {
  if (!firebaseUser) return null;
  return {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || "Unknown User",
    email: firebaseUser.email || "",
    picture: firebaseUser.photoURL || undefined
  };
};

export const authService = {
  // Get current user synchronously
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

  // Register with Email/Password
  register: async (name: string, email: string, password: string): Promise<User> => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      // Update the user profile with their name
      await updateProfile(result.user, { displayName: name });
      return mapUser({ ...result.user, displayName: name }) as User;
    } catch (error) {
      console.error("Registration Error", error);
      throw error;
    }
  },

  // Login with Email/Password
  login: async (email: string, password?: string): Promise<User> => {
    // Handle Demo Login specifically for testing
    if (email === 'admin@test.com' && password === 'password') {
      const demoUser: User = { id: 'demo_admin', name: 'Demo Admin', email: 'admin@test.com' };
      localStorage.setItem('sbSquaresUser', JSON.stringify(demoUser));
      return demoUser;
    }

    if (!password) throw new Error("Password required");

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      return mapUser(result.user) as User;
    } catch (error) {
      console.error("Login Error", error);
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
    return onAuthStateChanged(auth, (firebaseUser) => {
      const demoUser = localStorage.getItem('sbSquaresUser');
      if (demoUser && !firebaseUser) {
        callback(JSON.parse(demoUser));
      } else {
        callback(mapUser(firebaseUser));
      }
    });
  }
};