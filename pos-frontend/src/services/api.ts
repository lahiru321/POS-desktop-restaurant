import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { performLogout } from '@/lib/performLogout';

// `??` not `||`: an empty string means "same-origin, use the relative /api/v1
// path" (production proxy via next.config rewrites). Only unset/undefined falls
// back to the local-dev backend.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8082';

/**
 * Pre-configured Axios instance for all API calls.
 * - Base URL from env
 * - JWT token injection via interceptor
 * - Tenant ID injection via interceptor
 * - 401 auto-logout
 */
const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  timeout: 15000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * The shop subdomain from the current host, e.g. "shopa" from
 * shopa.localhost:3000 or shopa.yourpos.com. Returns null for bare hosts
 * (localhost, www, apex domains). Used as X-Tenant-Domain so the backend can
 * resolve the tenant for PIN login in shared-DB (multi-tenant) deployments;
 * single-tenant deployments ignore it.
 */
const tenantSubdomain = (): string | null => {
  if (typeof window === 'undefined') return null;
  const labels = window.location.hostname.split('.');
  if (labels.length < 2) return null; // bare "localhost" — no subdomain
  const first = labels[0];
  if (!first || first === 'www') return null;
  return first;
};

// Request interceptor — attach JWT and tenant ID
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { token, user } = useAuthStore.getState();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (user?.tenantId) {
      config.headers['X-Tenant-ID'] = user.tenantId;
    }

    const subdomain = tenantSubdomain();
    if (subdomain) {
      config.headers['X-Tenant-Domain'] = subdomain;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Mutex and queue for concurrent token refreshes
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value?: unknown) => void; reject: (reason?: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor — handle 401 auto-logout & token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If 401 and not already retrying
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const { refreshToken, setAuth, user, loginMethod } = useAuthStore.getState();

      if (!refreshToken || !user) {
        isRefreshing = false;
        await performLogout();
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        // Use clean axios to prevent infinite loops if refresh fails. The
        // explicit timeout matters: the `api` instance has timeout: 15000 but
        // this bare axios call inherits the library default of 0 (no timeout).
        // Without it, a momentarily-unresponsive backend (e.g. loopback during
        // desktop startup) makes this hang forever, which leaves AuthGuard stuck
        // on the "Verifying session..." spinner.
        const response = await axios.post(
          `${API_BASE_URL}/api/v1/auth/refresh`,
          {
            refreshToken,
            tenantId: user.tenantId,
          },
          { timeout: 15000 }
        );
        const data = response.data.data;

        // Backend returns `accessToken`, not `token`. Preserve the original login
        // method across silent refresh so a PIN session stays a PIN session.
        setAuth(data.user, data.accessToken, data.refreshToken, loginMethod ?? 'PASSWORD');
        processQueue(null, data.accessToken);

        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await performLogout();
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
