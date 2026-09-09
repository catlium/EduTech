import { NextResponse, type NextRequest } from "next/server";

// Server-side protection for authenticated (workspace) routes. Guards that
// happen client-side too (apps/web/src/lib/auth.tsx + the workspace layout),
// but without this the protected page shell renders before the redirect.
// The access_token cookie is httpOnly — only readable here, on the server.
function isProtected(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname === "/subjects" ||
    pathname === "/materials" ||
    pathname === "/questions" ||
    pathname === "/assessments" ||
    pathname.startsWith("/subjects/") ||
    pathname.startsWith("/assessments/") ||
    pathname.startsWith("/student/")
  );
}

export function middleware(request: NextRequest) {
  if (!isProtected(request.nextUrl.pathname)) return NextResponse.next();
  if (request.cookies.has("access_token")) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/subjects/:path*",
    "/materials/:path*",
    "/questions/:path*",
    "/assessments/:path*",
    "/student/:path*",
  ],
};