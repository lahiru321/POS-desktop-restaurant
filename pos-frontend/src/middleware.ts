import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/super-admin/login',
  '/forgot-password'
];

/**
 * Admin-only page prefixes for tenant users, mirrored from the backend's
 * `@PreAuthorize("hasAnyRole('ADMIN','MANAGER')")` on the tables/toppings CRUD
 * (`TableController`, `ToppingController`) and from `SidebarNav`'s
 * RESTAURANT_ADMIN_LABELS filter.
 *
 * Note `/floor` and `/terminal` are deliberately absent — those are the service
 * screens a cashier is supposed to use (their controllers allow CASHIER).
 */
const ADMIN_ONLY_PREFIXES = ['/restaurant'];

/** Where a non-admin gets sent instead. The POS terminal is the cashier's home
 *  screen: it is gated by AuthGuard only, has no role check of its own, and its
 *  data endpoints allow CASHIER — so it cannot bounce the user onward. Do NOT
 *  use /overview here: the dashboard API is ADMIN/MANAGER-only, so a cashier
 *  landing there would hit the exact broken-looking 403 screen this gate exists
 *  to prevent. */
const NON_ADMIN_HOME = '/terminal';

/**
 * Read the roles out of the tenant JWT carried by the `auth-token` cookie.
 *
 * !! THIS IS A UX GATE, NOT A SECURITY BOUNDARY. !!
 *
 * The JWT signing secret is never available at the edge, so this decodes the
 * payload WITHOUT verifying the signature. Anyone can forge a cookie with any
 * roles they like and walk straight past it. That is acceptable ONLY because
 * the real control is server-side: every restaurant admin endpoint carries
 * `@PreAuthorize("hasAnyRole('ADMIN','MANAGER')")`, which is enforced against a
 * signature-verified token by `JwtAuthenticationFilter`. All this function buys
 * is not showing a cashier an admin screen frame full of failed requests.
 *
 * Never delete the backend `@PreAuthorize` believing this covers it, and never
 * gate anything here that isn't ALSO enforced on the server.
 *
 * Claim name: `authorities` — see `JwtTokenProvider.CLAIM_AUTHORITIES`. It is a
 * string list holding permission names plus each role prefixed `ROLE_`
 * (`CustomUserDetailsService.getAuthorities`), e.g. `["ROLE_CASHIER", …]`.
 *
 * @returns true when the token grants ADMIN or MANAGER, false when it provably
 *          does not, and null when the token could not be read at all.
 */
function isAdminOrManager(token: string): boolean | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;
    // JWT uses base64url (- _ and no padding); atob() wants standard base64.
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload: unknown = JSON.parse(atob(padded));

    if (typeof payload !== 'object' || payload === null) return null;
    const authorities = (payload as { authorities?: unknown }).authorities;
    if (!Array.isArray(authorities)) return null;

    return authorities.some((a) => a === 'ROLE_ADMIN' || a === 'ROLE_MANAGER');
  } catch {
    // Unparseable/malformed token — fail OPEN (see the caller). A decode bug
    // must never lock a legitimate ADMIN out of their own admin screens.
    return null;
  }
}

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
  } else if (
    !isSuperAdminRoute &&
    authToken &&
    ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) &&
    // Fails OPEN: only a token we could read AND that provably lacks the role
    // is turned away. `null` (unparseable) falls through to the page, which
    // behaves exactly as it did before this gate existed.
    isAdminOrManager(authToken.value) === false
  ) {
    const url = request.nextUrl.clone();
    url.pathname = NON_ADMIN_HOME;
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
