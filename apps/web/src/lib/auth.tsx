'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { api, ApiError, setActiveInstituteId } from './api';
import { cleanupInstituteStorage } from './tenant';
import type { MembershipListItem, UserResponse } from '@catlium/contracts';

interface AuthState {
  user: UserResponse | null;
  memberships: MembershipListItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserResponse | null>(null);
  const [memberships, setMemberships] = useState<MembershipListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const hasIdentity = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [{ user }, membershipsResult] = await Promise.all([
        api<{ user: UserResponse }>('/auth/me'),
        api<{ memberships: MembershipListItem[] }>('/memberships'),
      ]);
      hasIdentity.current = true;
      setUser(user);
      setMemberships(membershipsResult.memberships ?? []);
      setLoading(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // The refresh endpoint itself rejected the session (401/403) — the
        // session is genuinely gone, so a logout redirect is correct.
        hasIdentity.current = false;
        setUser(null);
        setMemberships([]);
        setLoading(false);
      } else {
        // Transient failure (network / 5xx). The cookies may still be valid —
        // never log an authenticated user out on a blip. If we never had an
        // identity yet, stay on the loader so AuthGuard can't bounce a valid
        // session to /login; any later refresh() call recovers.
        if (hasIdentity.current) setLoading(false);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // session may already be invalid
    }
    setUser(null);
    setMemberships([]);
    setActiveInstituteId(null);
    cleanupInstituteStorage();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setMemberships([]);
      setActiveInstituteId(null);
      cleanupInstituteStorage();
      router.replace('/login');
    };
    window.addEventListener('catlium:unauthorized', onUnauthorized);
    return () => window.removeEventListener('catlium:unauthorized', onUnauthorized);
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, memberships, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
