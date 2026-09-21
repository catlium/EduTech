// Frontend permission checks are UX-only: the backend stays the authority and
// the key vocabulary lives server-side. The resolved grant set arrives from
// `GET /memberships`; this module only mirrors the backend's `*.manage`
// implication rule so UI gating matches what the API decides. Never treat a
// frontend check as an enforcement boundary, and never attempt to extend a
// key here that the catalogue does not define.

export function canUse(granted: readonly string[], key: string): boolean {
  if (!/^[a-z][\w-]*\.(read|create|update|delete|manage)$/.test(key)) return false;
  if (granted.includes(key)) return true;
  const dot = key.lastIndexOf('.');
  if (dot === -1 || key.slice(dot + 1) === 'manage') return false;
  return granted.includes(`${key.slice(0, dot)}.manage`);
}

export function canUseAny(granted: readonly string[], keys: readonly string[]): boolean {
  return keys.some((key) => canUse(granted, key));
}