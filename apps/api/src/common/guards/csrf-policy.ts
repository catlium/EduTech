export type CsrfVerdict = 'pass' | 'missing' | 'mismatch';

// Pure double-submit decision — lives apart from the decorated guard so the
// unit runner (strip-only, no decorators) can load it.
export function decideCsrf(
  method: string,
  hasAccessCookie: boolean,
  cookieToken: string | undefined,
  headerToken: string | undefined,
): CsrfVerdict {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return 'pass';
  }
  // The double-submit guard applies only to the cookie-authenticated plane —
  // no access cookie means this is not a browser session (login is covered by
  // the login Origin check; the OCR worker bearer protocol carries no
  // cookies), so leave it to the auth guards.
  if (!hasAccessCookie) {
    return 'pass';
  }
  if (!cookieToken || !headerToken) {
    return 'missing';
  }
  return cookieToken === headerToken ? 'pass' : 'mismatch';
}