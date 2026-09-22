import { NextResponse, type NextRequest } from 'next/server';
import { shouldAllowProtectedRoute } from './lib/session-guard';

const PROTECTED = [
  '/dashboard',
  '/subjects',
  '/materials',
  '/content',
  '/questions',
  '/assessments',
  '/paper-patterns',
  '/practice',
  '/student',
  '/institute',
  '/users',
  '/ocr',
  '/profile',
  '/platform',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectedMatch = PROTECTED.find(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
  if (!protectedMatch) return NextResponse.next();
  if (
    shouldAllowProtectedRoute({
      hasAccessToken: request.cookies.has('access_token'),
      hasCsrfToken: request.cookies.has('csrf_token'),
    })
  ) {
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/subjects/:path*',
    '/materials/:path*',
    '/content/:path*',
    '/questions/:path*',
    '/assessments/:path*',
    '/paper-patterns/:path*',
    '/practice/:path*',
    '/student/:path*',
    '/institute/:path*',
    '/users/:path*',
    '/ocr/:path*',
    '/profile/:path*',
    '/platform/:path*',
  ],
};
