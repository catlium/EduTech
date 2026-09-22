'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api } from './api';
import { canUse } from './permissions';
import { useAuth } from './auth';
import type { PlatformPermissionProbe } from './platform-scope';

// The platform console's own grant source (Phase N.5). The workspace reads
// institute-domain permissions from GET /memberships; this mirrors it on the
// platform plane via GET /platform/permissions — the caller's CURRENT
// platform grants, resolved DB-fresh by the backend (never from a JWT). UX-only:
// the backend remains the authorization boundary and every console action
// re-checks its own platform key.
interface PlatformState {
  permissions: string[];
  loading: boolean;
  /** UX mirror of the backend's `*.manage` implication, like `hasPermission`. */
  can: (key: string) => boolean;
  /** Super Admin console entry gate: institutes.read (console base access). */
  canAccessConsole: boolean;
}

const PlatformContext = createContext<PlatformState | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setPermissions([]);
      return;
    }
    let active = true;
    setLoading(true);
    api<PlatformPermissionProbe>('/platform/permissions')
      .then((probe) => {
        if (!active) return;
        setPermissions(probe.permissions ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const can = useCallback((key: string) => canUse(permissions, key), [permissions]);

  return (
    <PlatformContext.Provider
      value={{
        permissions,
        loading,
        can,
        canAccessConsole: canUse(permissions, 'institutes.read'),
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformState {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider');
  return ctx;
}
