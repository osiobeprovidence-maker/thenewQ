import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from 'firebase/auth';
import { auth } from '../lib/firebase.js';
import { checkMyPendingStaffInvitation, fetchStaffAccess } from '../lib/staffAccess';
import { supabase } from '../lib/supabase.js';

export interface UserProfileData {
  user_id: string;
  username: string;
  display_name: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  created_at?: string;
  status?: string;
}

interface AuthContextType {
  currentUser: User | null;
  profile: UserProfileData | null;
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isSupport: boolean;
  hasPendingStaffInvite: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signupWithEmail: (email: string, pass: string, fullName: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  setupPhoneRecaptcha: (containerId: string) => RecaptchaVerifier;
  sendPhoneOtp: (phone: string, recaptchaVerifier: RecaptchaVerifier) => Promise<ConfirmationResult>;
  confirmPhoneOtp: (confirmationResult: ConfirmationResult, code: string) => Promise<void>;
  updateUserProfile: (updates: Partial<UserProfileData>) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Re-reads Firebase custom claims into context state (call after granting/revoking roles). */
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isSupport, setIsSupport] = useState(false);
  const [hasPendingStaffInvite, setHasPendingStaffInvite] = useState(false);

  // Sync profile data to Supabase
  const syncProfileToSupabase = async (user: User, customDisplayName?: string) => {
    try {
      const displayName = customDisplayName || user.displayName || user.email?.split('@')[0] || 'Member';
      const username = user.email ? user.email.split('@')[0].toLowerCase() : `user_${user.uid.slice(0, 8)}`;
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.uid)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.warn('Could not fetch profile from Supabase:', error);
      }

      if (data) {
        setProfile(data as UserProfileData);
      } else {
        const newProfile: UserProfileData = {
          user_id: user.uid,
          username,
          display_name: displayName,
          email: user.email || undefined,
          phone: user.phoneNumber || undefined,
          avatar_url: user.photoURL || undefined,
          status: 'active',
        };

        const { data: inserted, error: insertError } = await supabase
          .from('profiles')
          .insert(newProfile)
          .select()
          .single();

        if (insertError) {
          console.warn('Could not create profile record in Supabase (will use fallback):', insertError);
          setProfile(newProfile);
        } else {
          setProfile(inserted as UserProfileData);
        }
      }
    } catch (err) {
      console.error('Error synchronizing profile:', err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const access = await fetchStaffAccess();
          setIsAdmin(access.isAdmin);
          setIsSuperAdmin(access.isSuperAdmin);
          setIsSupport(access.isSupport);
        } catch (e) {
          console.warn('Could not fetch staff access:', e);
        }
        try {
          const pending = await checkMyPendingStaffInvitation();
          setHasPendingStaffInvite(Boolean(pending?.pending));
        } catch (e) {
          console.warn('Could not check pending invitation:', e);
          setHasPendingStaffInvite(false);
        }
        await syncProfileToSupabase(user);
      } else {
        setProfile(null);
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setIsSupport(false);
        setHasPendingStaffInvite(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    await syncProfileToSupabase(result.user);
  };

  const loginWithEmail = async (email: string, pass: string) => {
    const result = await signInWithEmailAndPassword(auth, email.trim(), pass);
    await syncProfileToSupabase(result.user);
  };

  const signupWithEmail = async (email: string, pass: string, fullName: string) => {
    const result = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    await syncProfileToSupabase(result.user, fullName);
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const setupPhoneRecaptcha = (containerId: string) => {
    return new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
      callback: () => {
        // reCAPTCHA solved
      },
    });
  };

  const sendPhoneOtp = async (phone: string, recaptchaVerifier: RecaptchaVerifier) => {
    return signInWithPhoneNumber(auth, phone.trim(), recaptchaVerifier);
  };

  const confirmPhoneOtp = async (confirmationResult: ConfirmationResult, code: string) => {
    const result = await confirmationResult.confirm(code.trim());
    await syncProfileToSupabase(result.user);
  };

  const updateUserProfile = async (updates: Partial<UserProfileData>) => {
    if (!currentUser) throw new Error('No user signed in');

    const updatedProfile = {
      ...profile,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', currentUser.uid);

    if (error) {
      console.warn('Could not update profile in Supabase:', error);
    }

    setProfile(updatedProfile as UserProfileData);
  };

  const logout = async () => {
    await signOut(auth);
    setProfile(null);
    setIsAdmin(false);
    setIsSuperAdmin(false);
    setIsSupport(false);
  };

  const refreshProfile = async () => {
    if (currentUser) {
      await syncProfileToSupabase(currentUser);
    }
  };

  const refreshClaims = async () => {
    if (!currentUser) return;
    try {
      const access = await fetchStaffAccess();
      setIsAdmin(access.isAdmin);
      setIsSuperAdmin(access.isSuperAdmin);
      setIsSupport(access.isSupport);
      const pending = await checkMyPendingStaffInvitation();
      setHasPendingStaffInvite(Boolean(pending?.pending));
    } catch (e) {
      console.warn('Could not refresh staff access:', e);
      throw e;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        profile,
        loading,
        isAdmin,
        isSuperAdmin,
        isSupport,
        hasPendingStaffInvite,
        loginWithGoogle,
        loginWithEmail,
        signupWithEmail,
        sendPasswordReset,
        setupPhoneRecaptcha,
        sendPhoneOtp,
        confirmPhoneOtp,
        updateUserProfile,
        logout,
        refreshProfile,
        refreshClaims,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
