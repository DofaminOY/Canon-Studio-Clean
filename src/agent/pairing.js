import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { allowedOrigin } from '../http/origins.js';

const PIN_LIFETIME_MS = 5 * 60_000;
const SESSION_LIFETIME_MS = 12 * 60 * 60_000;
const MAX_ATTEMPTS = 5;

// Only local UI can reveal the one-time code. The public website cannot read it.
export function isLocalBrowserRequest(req) {
  const host = String(req.headers.host || '');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'none';
}

export function createPairingManager({ now = () => Date.now(), pinGenerator = () => String(randomInt(10_000_000, 100_000_000)) } = {}) {
  let pending = null;
  const sessions = new Map();
  const failures = new Map();

  function issuePin() {
    pending = { value: String(pinGenerator()), expires: now() + PIN_LIFETIME_MS };
    return { code: pending.value, expiresInSeconds: PIN_LIFETIME_MS / 1000 };
  }

  function pair(origin, code) {
    // Explicitly trust one configured HTTPS origin only (never wildcard CORS).
    if (!origin || !allowedOrigin(origin) || !origin.startsWith('https://')) return { ok: false, status: 403 };
    let failed = failures.get(origin);
    if (failed && failed.until > now()) return { ok: false, status: 429 };
    if (failed && failed.until && failed.until <= now()) { failures.delete(origin); failed = null; }
    if (!pending || pending.expires <= now()) return { ok: false, status: 403 };
    const expected = Buffer.from(pending.value);
    const supplied = Buffer.from(String(code || ''));
    const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    if (!matches) {
      const count = (failed?.count || 0) + 1;
      failures.set(origin, count >= MAX_ATTEMPTS ? { count, until: now() + PIN_LIFETIME_MS } : { count, until: 0 });
      return { ok: false, status: count >= MAX_ATTEMPTS ? 429 : 403 };
    }
    pending = null; // Single-use code
    failures.delete(origin);
    const token = randomBytes(32).toString('hex');
    sessions.set(origin, { token, expires: now() + SESSION_LIFETIME_MS });
    return { ok: true, token, expiresInSeconds: SESSION_LIFETIME_MS / 1000 };
  }

  function authorized(origin, token) {
    if (!origin || !token) return false;
    const session = sessions.get(origin);
    if (!session || session.expires <= now()) return false;
    const stored = Buffer.from(session.token);
    const offered = Buffer.from(String(token));
    return stored.length === offered.length && timingSafeEqual(stored, offered);
  }

  function revokeAll() { sessions.clear(); pending = null; failures.clear(); }
  return { issuePin, pair, authorized, revokeAll };
}
