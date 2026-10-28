import { PORT } from '../config.js';

// No wildcards: every public website must be explicitly trusted by the agent owner.
export function allowedOrigin(origin, configured = process.env.CANON_STUDIO_ALLOWED_ORIGIN || '') {
  if (!origin || typeof origin !== 'string') return false;
  if (origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`) return true;
  if (!configured) return false;
  try {
    const provided = new URL(origin);
    const trusted = new URL(configured);
    return provided.origin === trusted.origin && trusted.protocol === 'https:' &&
      trusted.hostname !== 'localhost' && !trusted.username && !trusted.password &&
      configured === trusted.origin;
  } catch { return false; }
}

export function safeLoopbackHost(host) {
  return /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(String(host || ''));
}

export function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Canon-Token',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}
