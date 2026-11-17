const SESSION_STORAGE_KEY = 'seva_session_token';

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token?: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent('seva:auth-changed'));
  } catch {
    // ignore storage errors in restricted environments
  }
}

export function clearSessionToken(): void {
  setSessionToken(null);
}

export function withAuthToken(url?: string | null): string {
  if (!url) return '';
  const token = getSessionToken();
  if (!token) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const token = getSessionToken();
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const resp = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `HTTP ${resp.status}` };
  }

  if (!resp.ok) {
    if (resp.status === 401 && url !== '/api/auth/login/password' && url !== '/api/auth/authority/login') {
      // Clear stale token if server rejected it (not during a failed password check)
      if (!url.includes('/login')) {
        clearSessionToken();
      }
    }
    const err = new Error(data?.error || `Request failed with status ${resp.status}`) as Error & {
      status?: number;
      data?: any;
    };
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data as T;
}

export function navigateTo(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new CustomEvent('seva:navigate', { detail: { path } }));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
