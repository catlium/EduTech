'use client';

import { useEffect, useState } from 'react';

import { api, ApiError } from './api';
import { useTenant } from './tenant';
import type { AcademicScopeDetail } from '@catlium/contracts';

// Module-level TTL cache so multiple components on one page share a single
// /memberships/scope fetch. This is a UX snapshot ONLY — the backend endpoint
// is authoritative and the cache is dropped on `refresh()` or after the TTL.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { scope: AcademicScopeDetail; at: number }>();

export interface MyScope {
  scope: AcademicScopeDetail | null;
  error: string | null;
  refresh: () => void;
}

export function useMyScope(): MyScope {
  const { instituteId } = useTenant();
  const [scope, setScope] = useState<AcademicScopeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!instituteId) return;
    const entry = cache.get(instituteId);
    if (entry && Date.now() - entry.at < TTL_MS) {
      setScope(entry.scope);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    api<{ scope: AcademicScopeDetail }>('/memberships/scope')
      .then(({ scope }) => {
        if (cancelled) return;
        cache.set(instituteId, { scope, at: Date.now() });
        setScope(scope);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load academic scope');
      });
    return () => {
      cancelled = true;
    };
  }, [instituteId, revision]);

  return {
    scope,
    error,
    refresh: () => {
      if (instituteId) cache.delete(instituteId);
      setRevision((r) => r + 1);
    },
  };
}