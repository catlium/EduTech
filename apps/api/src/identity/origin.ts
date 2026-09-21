import type { Request } from 'express';

// H7 / D7 §19 F4 — login CSRF: the double-submit guard cannot apply before a
// csrf cookie exists, so login enforces Origin validation instead. A
// cross-site top-level form POST carries a foreign Origin; same-origin fetch
// from the web (nginx preserves `$host`) matches. Absent Origin (curl,
// servers, privacy clients) is allowed — the check exists to stop cross-site
// browser POSTs, not headless callers.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers['origin'] as string | undefined;
  if (!origin) return true;

  let originHost: string | undefined;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }

  return originHost === undefined || originHost === request.headers.host;
}