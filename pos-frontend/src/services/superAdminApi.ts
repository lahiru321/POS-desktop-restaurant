import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useSuperAdminStore } from '@/stores/superAdminStore';

// `??` not `||`: an empty string means "same-origin, relative /api/v1" (prod
// proxy); only unset/undefined falls back to the local-dev backend.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8082';

/**
 * Pre-configured Axios instance for Super Admin API calls.
 * - Entirely separate from tenant API calls.
 * - No X-Tenant-ID header injected.
 * - Memory-only access token, refreshed silently on 401 (matches the tenant
 *   authStore pattern in services/api.ts).
 */
const superAdminApi = axios.create({
  baseURL: `${API_BASE_URL}/api/v1/super-admin`,
  timeout: 15000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

superAdminApi.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { token } = useSuperAdminStore.getState();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Mutex + queue so concurrent requests share a single refresh round-trip.
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value?: unknown) => void; reject: (reason?: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
};

const hardLogout = async () => {
  const { logout } = useSuperAdminStore.getState();
  logout();
  // Best-effort cookie clear.
  try {
    await fetch('/api/super-admin-logout', { method: 'POST' });
  } catch {
    /* swallow */
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/super-admin/login';
  }
};

superAdminApi.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Don't try to refresh on the refresh / logout calls themselves; that would loop.
    const url = originalRequest?.url ?? '';
    const isAuthCall = url.includes('/auth/refresh') || url.includes('/auth/logout') || url.includes('/auth/login');

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthCall) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => failedQueue.push({ resolve, reject }))
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return superAdminApi(originalRequest);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const { refreshToken, setAuth } = useSuperAdminStore.getState();
      if (!refreshToken) {
        isRefreshing = false;
        await hardLogout();
        return Promise.reject(error);
      }

      try {
        // Use a clean axios instance to dodge the interceptor recursion.
        const refreshResponse = await axios.post(
          `${API_BASE_URL}/api/v1/super-admin/auth/refresh`,
          { refreshToken },
          // Explicit timeout: this bare axios call inherits the library default of
          // 0 (no timeout). Without it, an unresponsive backend hangs the silent
          // refresh forever and the super-admin console sticks on its loading state
          // — the same failure mode that hit the tenant refresh in api.ts.
          { withCredentials: true, timeout: 15000 }
        );
        const data = refreshResponse.data.data;
        setAuth(data.superAdmin, data.accessToken, data.refreshToken);
        processQueue(null, data.accessToken);

        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return superAdminApi(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await hardLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default superAdminApi;
