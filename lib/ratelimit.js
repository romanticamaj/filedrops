// lib/ratelimit.js
// Tiny in-memory sliding-window rate limiter. Keyed by client IP.
function rateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip -> number[] (timestamps)
  return function limit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).send('too many requests');
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}
module.exports = { rateLimiter };
