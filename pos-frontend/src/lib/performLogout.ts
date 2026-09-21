import { useAuthStore } from '@/stores/authStore';

let inFlight: Promise<void> | null = null;

// Clears all auth state: the backend session cookie (via local Next.js route),
// the backend refresh token (best-effort), and the Zustand store.
//
// Deduplicated: concurrent callers share the same in-flight promise so we don't
// hammer /api/logout during a 401 storm.
export async function performLogout(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // Local Next.js route — always reachable, clears httpOnly auth-token cookie.
      // Can't be an async import from '@/services/api' here: the api module owns
      // the refresh interceptor that calls us, and we'd create a circular import.
      await fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {
        // Network failure shouldn't block the logout flow.
      });

      // Best-effort backend logout to revoke the refresh token server-side.
      // Fire-and-forget: if the backend is down, we still want to proceed locally.
      const { token } = useAuthStore.getState();
      if (token) {
        // `??`: empty string = same-origin relative /api/v1 (prod proxy).
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8082';
        fetch(`${apiUrl}/api/v1/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {
          // Ignore — local state is already being cleared.
        });
      }
    } finally {
      useAuthStore.getState().logout();
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
