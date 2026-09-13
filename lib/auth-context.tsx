"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ID, OAuthProvider, type Models } from "appwrite";
import { account, tablesDB } from "./appwrite";
import { DATABASE_ID, TABLES } from "./constants";
import type { Profile } from "./types";

interface AuthContextValue {
  user: Models.User<Models.Preferences> | null;
  profile: Profile | null;
  loading: boolean;
  signInWithGoogle: () => void;
  signInWithApple: () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// A backgrounded/suspended tab (e.g. iOS holding an in-flight request across a
// rapid app-switcher relaunch) can leave account.get()/getRow() pending forever --
// neither resolving nor rejecting. Without a bound, `loading` never flips to
// false and every gated screen spins indefinitely.
const AUTH_FETCH_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function redirectUrls() {
  const origin = window.location.origin;
  return { success: `${origin}/dashboard`, failure: `${origin}/sign-in` };
}

/**
 * Resolves the current user and profile together before returning, so callers can set
 * both in one uninterrupted block. Setting them from two separate awaited calls (user
 * first, profile after another await) lets React commit a render in between where user
 * is truthy but profile is still the old value -- long enough for a consumer's redirect
 * effect (e.g. sign-in routing to /dashboard vs /onboarding) to act on stale state.
 */
async function fetchUserAndProfile(): Promise<{
  user: Models.User<Models.Preferences> | null;
  profile: Profile | null;
}> {
  try {
    const current = await account.get();
    try {
      const row = await tablesDB.getRow<Profile>(DATABASE_ID, TABLES.profiles, current.$id);
      return { user: current, profile: row };
    } catch {
      return { user: current, profile: null };
    }
  } catch {
    return { user: null, profile: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Models.User<Models.Preferences> | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const result = await withTimeout(fetchUserAndProfile(), AUTH_FETCH_TIMEOUT_MS, {
      user: null,
      profile: null,
    });
    setUser(result.user);
    setProfile(result.profile);
  }, []);

  useEffect(() => {
    (async () => {
      const result = await withTimeout(fetchUserAndProfile(), AUTH_FETCH_TIMEOUT_MS, {
        user: null,
        profile: null,
      });
      setUser(result.user);
      setProfile(result.profile);
      setLoading(false);
    })();
  }, []);

  const signInWithGoogle = useCallback(() => {
    const { success, failure } = redirectUrls();
    account.createOAuth2Session(OAuthProvider.Google, success, failure);
  }, []);

  const signInWithApple = useCallback(() => {
    const { success, failure } = redirectUrls();
    account.createOAuth2Session(OAuthProvider.Apple, success, failure);
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      await account.createEmailPasswordSession(email, password);
      await refreshProfile();
    },
    [refreshProfile]
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, name: string) => {
      // The account name doubles as the username shown around the app before someone
      // sets a display name; default it from the email's local part, matching how
      // Google OAuth sign-in defaults it from the Google profile's name.
      const username = name.trim() || email.split("@")[0];
      await account.create(ID.unique(), email, password, username);
      await account.createEmailPasswordSession(email, password);
      await refreshProfile();
    },
    [refreshProfile]
  );

  const signOut = useCallback(async () => {
    await account.deleteSession("current");
    setUser(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signInWithGoogle,
        signInWithApple,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
