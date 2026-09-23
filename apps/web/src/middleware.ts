import { NextResponse, type NextRequest } from 'next/server';
import { shouldAllowProtectedRoute } from './lib/session-guard';

const PROTECTED = [
  '/dashboard',
  '/subjects',
  '/materials',
  '/content',
  '/questions',
  '/assessments',
  '/question-papers',
  '/paper-patterns',
  '/practice',
  '/syllabus',
  '/jobs',
  '/student',
  '/institute',
  '/institutes',
  '/users',
  '/ocr',
  '/profile',
  '/platform',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = {
    hasAccessToken: request.cookies.has('access_token'),
    hasCsrfToken: request.cookies.has('csrf_token'),
  };
  const signedIn = shouldAllowProtectedRoute(session);

  if (pathname === '/login') {
    if (!signedIn) return NextResponse.next();
    const dashboard = request.nextUrl.clone();
    dashboard.pathname = '/dashboard';
    dashboard.search = '';
    return NextResponse.redirect(dashboard);
  }

  const protectedMatch = PROTECTED.find(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
  if (!protectedMatch || signedIn) return NextResponse.next();

  // Anonymous viewers are not forced into the login flow: they land on the
  // public marketing page and only reach /login when they choose to sign in.
  const landing = request.nextUrl.clone();
  landing.pathname = '/';
  landing.search = '';
  return NextResponse.redirect(landing);
}

export const config = {
  matcher: [
    '/login',
    '/dashboard/:path*',
    '/subjects/:path*',
    '/materials/:path*',
    '/content/:path*',
    '/questions/:path*',
    '/assessments/:path*',
    '/question-papers/:path*',
    '/paper-patterns/:path*',
    '/practice/:path*',
    '/syllabus/:path*',
    '/jobs/:path*',
    '/student/:path*',
    '/institute/:path*',
    '/institutes/:path*',
    '/users/:path*',
    '/ocr/:path*',
    '/profile/:path*',
    '/platform/:path*',
  ],
};
