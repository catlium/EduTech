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

import { setActiveInstituteId } from "./api";
import { useAuth } from "./auth";
import type { MembershipListItem } from "@catlium/contracts";

interface TenantState {
  instituteId: string | null;
  institute: MembershipListItem | null;
  selectInstitute: (institute: MembershipListItem) => void;
}

const TenantContext = createContext<TenantState | null>(null);
const STORAGE_KEY = "catlium:instituteId";

export function TenantProvider({ children }: { children: ReactNode }) {
  const { memberships, loading, user } = useAuth();
  const router = useRouter();
  const [instituteId, setInstituteId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  useEffect(() => {
    setActiveInstituteId(instituteId);
  }, [instituteId]);

  const selected = memberships.find((m) => m.instituteId === instituteId) ?? null;
  const match = selected ?? (memberships.length === 1 ? memberships[0] : undefined);
  const effective = match ?? null;

  useEffect(() => {
    if (loading || !user) return;
    if (effective) {
      setActiveInstituteId(effective.instituteId);
      window.localStorage.setItem(STORAGE_KEY, effective.instituteId);
      setInstituteId(effective.instituteId);
    } else if (!instituteId) {
      router.replace("/institutes");
    }
  }, [effective, instituteId, loading, router, user]);

  const selectInstitute = useCallback(
    (institute: MembershipListItem) => {
      window.localStorage.setItem(STORAGE_KEY, institute.instituteId);
      setActiveInstituteId(institute.instituteId);
      setInstituteId(institute.instituteId);
      router.replace("/dashboard");
    },
    [router],
  );

  return (
    <TenantContext.Provider value={{ instituteId, institute: effective, selectInstitute }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantState {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}

export function isInstituteAdmin(institute: MembershipListItem | null): boolean {
  return institute?.roles.includes("INSTITUTE_ADMIN") ?? false;
}

export function isTeacher(institute: MembershipListItem | null): boolean {
  return institute?.roles.includes("TEACHER") ?? false;
}

export function canManage(institute: MembershipListItem | null): boolean {
  return isInstituteAdmin(institute) || isTeacher(institute);
}

export function cleanupInstituteStorage() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
    setActiveInstituteId(null);
  }
}