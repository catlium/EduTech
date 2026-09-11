"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { api, setActiveInstituteId } from "./api";
import type { MembershipListItem, UserResponse } from "@catlium/contracts";

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

  const refresh = useCallback(async () => {
    try {
      const [{ user }, membershipsResult] = await Promise.all([
        api<{ user: UserResponse }>("/auth/me"),
        api<{ memberships: MembershipListItem[] }>("/memberships"),
      ]);
      setUser(user);
      setMemberships(membershipsResult.memberships ?? []);
    } catch {
      setUser(null);
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // session may already be invalid
    }
    setUser(null);
    setMemberships([]);
    setActiveInstituteId(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setMemberships([]);
      setActiveInstituteId(null);
      router.replace("/login");
    };
    window.addEventListener("catlium:unauthorized", onUnauthorized);
    return () => window.removeEventListener("catlium:unauthorized", onUnauthorized);
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
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}