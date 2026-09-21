import { NextResponse, NextRequest } from 'next/server';

// Server-side route: must use an absolute backend URL (a relative path has no
// origin on the server). Prefer BACKEND_URL (set in prod alongside the
// same-origin proxy, where NEXT_PUBLIC_API_URL is empty); fall back to the
// public var for local dev.
const API_BASE_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082';

/**
 * Calls the backend's super-admin logout (which audits the event and
 * revokes the refresh token) and then clears the httpOnly
 * `sa-auth-token` cookie locally so the Next.js middleware stops
 * letting the browser into /super-admin/* routes.
 */
export async function POST(request: NextRequest) {
  const cookie = request.headers.get('cookie') ?? '';
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    await fetch(`${API_BASE_URL}/api/v1/super-admin/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward cookies so the backend can read sa-auth-token for actor identification.
        cookie,
      },
      body: JSON.stringify(body),
      // Don't surface backend failure to the client — local cookie clear
      // must always succeed so the user is "logged out" in the browser.
    });
  } catch {
    /* swallow */
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('sa-auth-token', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
  });
  return response;
}
