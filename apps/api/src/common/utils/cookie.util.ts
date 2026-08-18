import { Response } from 'express';

export interface CookieOptions {
  accessExpiresMs: number;
  refreshExpiresMs: number;
  sameSite: 'strict' | 'lax' | 'none';
  secure: boolean;
  domain?: string;
}

export function getCookieOptions(): CookieOptions {
  const sameSite = (process.env['COOKIE_SAMESITE'] ?? 'lax') as 'strict' | 'lax' | 'none';
  const secure = process.env['COOKIE_SECURE'] === 'true';
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
    path: '/api/v1',
    maxAge: options.accessExpiresMs,
  });
}

export function setRefreshCookie(response: Response, token: string, options: CookieOptions) {
  response.cookie('refresh_token', token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/api/v1/auth/refresh',
    maxAge: options.refreshExpiresMs,
  });
}

export function setCsrfCookie(response: Response, token: string, options: CookieOptions) {
  response.cookie('csrf_token', token, {
    httpOnly: false,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/api/v1',
    maxAge: options.accessExpiresMs,
  });
}

export function clearAuthCookies(response: Response, options: CookieOptions) {
  response.clearCookie('access_token', {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/api/v1',
  });
  response.clearCookie('refresh_token', {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/api/v1/auth/refresh',
  });
  response.clearCookie('csrf_token', {
    httpOnly: false,
    secure: options.secure,
    sameSite: options.sameSite,
    domain: options.domain,
    path: '/api/v1',
  });
}
