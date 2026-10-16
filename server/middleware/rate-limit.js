/**
 * EDX Digital - Who is calling, and how often
 *
 * clientAddress()      the caller's address, from what the host's proxies wrote, never from
 *                      what the caller wrote
 * createRateLimiter()  so many requests per window for each key
 */

// Proxies in front of the function that append their own entry to X-Forwarded-For.
// Production: browser -> Firebase Hosting -> Cloud Run (2nd gen function). Google's front end
// appends, after whatever the request already carried, the address that connected to it, and
// "does not verify any IP addresses that precede" the entries it added
// (https://cloud.google.com/load-balancing/docs/https, "X-Forwarded-For header"). So the left of
// the header is whatever the caller wrote; the trustworthy entry is counted from the right.
// Behind Hosting the rightmost is Hosting's own egress and the one before it is the browser.
// req.ip is not used: depending on Express's "trust proxy" it is either the leftmost entry or
// the internal socket. TRUSTED_PROXY_HOPS overrides the count if the chain ever changes.
const DEFAULT_PROXY_HOPS = 1;

function proxyHops(env) {
  const value = Number(env.TRUSTED_PROXY_HOPS);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_PROXY_HOPS;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 * @returns {string}
 */
function clientAddress(req, { env = process.env } = {}) {
  const socket = (req.socket && req.socket.remoteAddress) || 'unknown';
  // K_SERVICE is set by Cloud Run (https://cloud.google.com/run/docs/container-contract#env-vars).
  // Without it nobody stands in front (node server.js), so the header is only the caller's word.
  if (!env.K_SERVICE) return socket;
  const entries = String(req.headers['x-forwarded-for'] || '').split(',').map(item => item.trim()).filter(Boolean);
  if (entries.length === 0) return socket;
  return entries[Math.max(0, entries.length - 1 - proxyHops(env))];
}

/**
 * A sliding window per key, kept in memory. When the map grows past `maxKeys`, only the keys
 * whose window has passed are dropped: nobody's count goes back to zero in the middle of it.
 */
function createRateLimiter({ windowMs = 60000, maxKeys = 5000, clock = Date.now } = {}) {
  const hits = new Map();
  let lastSweep = 0;

  function sweep(now) {
    // a flood of live keys must not turn every request into a walk over the whole map
    if (now - lastSweep < 1000) return;
    lastSweep = now;
    for (const [key, times] of hits) {
      if (times.every(time => now - time >= windowMs)) hits.delete(key);
    }
  }

  /** @returns {boolean} true when the key already used its `limit` in this window */
  function tooMany(key, limit) {
    const now = clock();
    const recent = (hits.get(key) || []).filter(time => now - time < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > maxKeys) sweep(now);
    return false;
  }

  return { tooMany, size: () => hits.size };
}

module.exports = { clientAddress, createRateLimiter, DEFAULT_PROXY_HOPS };
