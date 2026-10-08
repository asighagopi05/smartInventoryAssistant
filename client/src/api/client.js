/**
 * Thin API client.
 *
 * The token lives in localStorage, but unlike the previous build nothing is
 * trusted from it: it is an opaque signed JWT, the server verifies the
 * signature on every request and re-reads the role from the database. Editing
 * localStorage here cannot grant a role.
 */

/**
 * The API is on port 5000 of whatever host served this page.
 *
 * Hardcoding localhost would break the QR codes: a phone that scans a shelf
 * label loads this app from the laptop LAN address, and "localhost" on the
 * phone means the phone itself. Deriving the host from window.location means
 * the same build works at localhost:5173 and at 192.168.x.x:5173 with no
 * configuration, and still needs no internet.
 */
const BASE = import.meta.env.VITE_API_URL
  || `${window.location.protocol}//${window.location.hostname}:5000/api`;
const TOKEN_KEY = 'sia_token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (token) => {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running on port 5000?');
  }

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (!res.ok) {
    // An expired or tampered token ends the session rather than leaving the
    // app in a half-authenticated state.
    if (res.status === 401 && auth && token) {
      setToken(null);
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  }

  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),

  // Public endpoints, used by the QR feedback page. No token is sent, because
  // a customer scanning a shelf label does not have one and never will.
  publicGet: (p) => request(p, { auth: false }),
  publicPost: (p, body) => request(p, { method: 'POST', body, auth: false }),
};

/** Money formatting, in one place. */
export const inr = (value, { compact = false } = {}) => {
  const n = Number(value) || 0;
  if (compact && Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (compact && Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  }).format(n);
};

export const shortDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export const longDate = (d) =>
  new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
