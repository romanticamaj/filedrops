const crypto = require('crypto');

function checkPassphrase(input, expected) {
  const a = Buffer.from(String(input));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payloadB64, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

function signToken(secret, now = Date.now()) {
  const payloadB64 = b64url(Buffer.from(JSON.stringify({ iat: now })));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

function verifyToken(token, secret, maxAgeMs, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch {
    return false;
  }
  if (typeof payload !== 'object' || payload === null) return false;
  if (typeof payload.iat !== 'number') return false;
  if (now - payload.iat > maxAgeMs) return false;
  return true;
}

module.exports = { checkPassphrase, signToken, verifyToken };
