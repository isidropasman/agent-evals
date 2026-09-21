import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  if (isPublicApi(request.nextUrl.pathname)) return NextResponse.next();

  const username = process.env.GAUNTLET_DASHBOARD_USER;
  const password = process.env.GAUNTLET_DASHBOARD_PASSWORD;
  if (!username || !password) {
    return new NextResponse("Dashboard authentication is not configured", { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization && matchesBasicAuth(authorization, username, password)) {
    return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Gauntlet dashboard", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function isPublicApi(pathname: string): boolean {
  return pathname === "/api/health" || pathname.startsWith("/api/v1/") || pathname === "/api/mcp";
}

function matchesBasicAuth(authorization: string, username: string, password: string): boolean {
  if (!authorization.startsWith("Basic ")) return false;
  try {
    const decoded = atob(authorization.slice("Basic ".length));
    return decoded === `${username}:${password}`;
  } catch {
    return false;
  }
}
