import type { User } from '../types';

const USER_KEY = 'sbSquaresUser';

export const authService = {
  // Check if user is logged in
  getCurrentUser: (): User | null => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  },

  // Mock Registration
  register: async (name: string, email: string, _password: string): Promise<User> => {
    // In a real app, verify email/password requirements
    const newUser: User = {
      id: 'user_' + Math.random().toString(36).substring(2, 9),
      name,
      email,
      picture: `https://api.dicebear.com/7.x/initials/svg?seed=${name}`
    };

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));

    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    return newUser;
  },

  // Mock Login
  login: async (email: string, _password: string): Promise<User> => {
    // In a real app, check credentials against DB
    await new Promise(resolve => setTimeout(resolve, 800));

    // Fix: Use consistent ID for demo admin so ownership persists
    const isDemoAdmin = email === 'admin@test.com';
    const userId = isDemoAdmin ? 'user_demo_admin_123' : 'user_' + Math.random().toString(36).substring(2, 9);

    const user: User = {
      id: userId,
      name: email.split('@')[0],
      email,
      picture: `https://api.dicebear.com/7.x/initials/svg?seed=${email}`
    };

    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  },

  // Mock Google Login
  loginWithGoogle: async (): Promise<User> => {
    // In a real app, this would use the Google Identity Services SDK
    // window.google.accounts.id.initialize(...)

    await new Promise(resolve => setTimeout(resolve, 1000));

    const googleUser: User = {
      id: 'google_' + Math.random().toString(36).substring(2, 9),
      name: 'Google User',
      email: 'user@gmail.com',
      picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c' // Generic google avatar
    };

    localStorage.setItem(USER_KEY, JSON.stringify(googleUser));
    return googleUser;
  },

  logout: () => {
    localStorage.removeItem(USER_KEY);
    // Trigger an event or page reload if needed, but App.tsx listens to state usually via a callback
    // For this simple mock, we rely on the caller to update state or reload
    window.location.reload();
  },

  // Observer pattern for auth state changes
  onAuthStateChanged: (callback: (user: User | null) => void) => {
    const handler = () => {
      callback(authService.getCurrentUser());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
};