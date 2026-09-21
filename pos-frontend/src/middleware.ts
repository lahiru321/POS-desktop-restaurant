import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/super-admin/login',
  '/forgot-password'
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets (brand logos, manifest, fonts…) are not pages — never run the
  // auth redirect on them, or public files like /storex-*.svg get 307'd to
  // /login and fail to load. (The matcher below also excludes them, but that
  // config doesn't hot-reload in dev, so guard here too.)
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|xml|woff2?|ttf|map)$/i.test(pathname)) {
    return NextResponse.next();
  }

  const isSuperAdminRoute = pathname.startsWith('/super-admin');
  // Super-admin pages are gated by a separate cookie so super-admin and
  // tenant-user sessions can coexist and don't invalidate each other.
  const authToken = isSuperAdminRoute
    ? request.cookies.get('sa-auth-token')
    : request.cookies.get('auth-token');
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  // Generate a unique per-request nonce for script-src.
  // Next.js reads x-nonce from request headers and adds it to its own inline scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // `??`: empty string = same-origin (prod proxy), so CSP connect-src/img-src
  // rely on 'self'; only unset falls back to the local-dev backend origin.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8082';
  // Allow unsafe-eval in development only (needed by Next.js HMR / React refresh).
  const scriptSrc = process.env.NODE_ENV === 'development'
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}'`;

  const cspHeader = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${apiUrl}`,
    "font-src 'self'",
    `connect-src 'self' ${apiUrl}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');

  // Pass nonce to Next.js so it stamps its own inline hydration scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  let response: NextResponse;

  if (!isPublicRoute && !authToken) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith('/super-admin') ? '/super-admin/login' : '/login';
    url.searchParams.set('callbackUrl', pathname);
    response = NextResponse.redirect(url);
  } else if (isPublicRoute && authToken && (pathname === '/login' || pathname === '/super-admin/login')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/super-admin/login' ? '/super-admin' : '/overview';
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - any static asset by extension (svg/png/etc.) so public files like the
     *   brand logos aren't auth-redirected to /login (which broke the <img>).
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|xml)$).*)',
  ],
};
