import type { Response } from 'express';

export interface CookieOptions {
  accessExpiresMs: number;
  refreshExpiresMs: number;
  sameSite: 'strict' | 'lax' | 'none';
  secure: boolean;
  domain?: string;
}

export function getCookieOptions(): CookieOptions {
  const sameSite = (process.env['COOKIE_SAMESITE'] ?? 'lax') as 'strict' | 'lax' | 'none';
  // Secure derives from NODE_ENV (production ⇒ Secure) so the default can
  // never be weakened by leaving an env var unset; an explicit COOKIE_SECURE
  // override exists only for documented deployments (local HTTP dev, a
  // deliberately non-Secure tunnel). dev is false; prod is true.
  const configured = process.env['COOKIE_SECURE'];
  const secure = configured !== undefined ? configured === 'true' : process.env['NODE_ENV'] === 'production';
  const accessMinutes = parseInt(process.env['ACCESS_TOKEN_EXPIRY_MINUTES'] ?? '15', 10);
  const refreshDays = parseInt(process.env['REFRESH_TOKEN_EXPIRY_DAYS'] ?? '30', 10);

  return {
    accessExpiresMs: accessMinutes * 60 * 1000,
    refreshExpiresMs: refreshDays * 24 * 60 * 60 * 1000,
    sameSite,
    secure,
    domain: process.env['COOKIE_DOMAIN'] || undefined,
  };
}

export function setAccessCookie(response: Response, token: string, options: CookieOptions) {
  response.cookie('access_token', token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    // '/' so the web app (served from a different port) sees the session in
    // its middleware; the refresh token below stays scoped to the auth paths.
    path: '/',
    maxAge: options.accessExpiresMs,
  });
}

export function setRefreshCookie(response: Response, token: string, options: CookieOptions) {
  response.cookie('refresh_token', token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/api/v1/auth',
    maxAge: options.refreshExpiresMs,
  });
}

export function setCsrfCookie(response: Response, token: string, options: CookieOptions) {
  response.cookie('csrf_token', token, {
    httpOnly: false,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/',
    // Outlives the 15-minute access cookie so the web client can rebuild an
    // expired session (POST /auth/refresh) without tripping the CSRF guard.
    maxAge: options.refreshExpiresMs,
  });
}

export function clearAuthCookies(response: Response, options: CookieOptions) {
  response.clearCookie('access_token', {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/',
  });
  response.clearCookie('refresh_token', {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/api/v1/auth',
  });
  response.clearCookie('csrf_token', {
    httpOnly: false,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/',
  });
}
