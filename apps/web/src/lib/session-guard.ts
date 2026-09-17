export interface SessionTrace {
  hasAccessToken: boolean;
  hasCsrfToken: boolean;
}

/** Allow a protected route when ANY live-session trace exists. The
 * access_token cookie is short-lived (15 min) and is dropped by the browser on
 * idle; the csrf_token cookie (30-day, path /, set on login and every refresh)
 * still proves the session is alive, and the client's refresh flow restores
 * the access cookie on the first API call. Redirect only when there is no
 * live-session trace at all. */
export function shouldAllowProtectedRoute({ hasAccessToken, hasCsrfToken }: SessionTrace): boolean {
  return hasAccessToken || hasCsrfToken;
}