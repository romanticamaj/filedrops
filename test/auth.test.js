const { test } = require('node:test');
const assert = require('node:assert');
const { checkPassphrase, signToken, verifyToken } = require('../lib/auth');

test('checkPassphrase true on exact match', () => {
  assert.strictEqual(checkPassphrase('hunter2', 'hunter2'), true);
});

test('checkPassphrase false on mismatch or length diff', () => {
  assert.strictEqual(checkPassphrase('wrong', 'hunter2'), false);
  assert.strictEqual(checkPassphrase('', 'hunter2'), false);
});

test('signed token verifies with same secret', () => {
  const t = signToken('sig', 1000);
  assert.strictEqual(verifyToken(t, 'sig', 10000, 5000), true);
});

test('token rejected with wrong secret', () => {
  const t = signToken('sig', 1000);
  assert.strictEqual(verifyToken(t, 'other', 10000, 5000), false);
});

test('token rejected when expired', () => {
  const t = signToken('sig', 1000);
  assert.strictEqual(verifyToken(t, 'sig', 1000, 5000), false); // 5000-1000 > 1000
});

test('malformed token rejected', () => {
  assert.strictEqual(verifyToken('garbage', 'sig', 10000, 5000), false);
  assert.strictEqual(verifyToken('a.b.c', 'sig', 10000, 5000), false);
});

test('token with valid signature but null payload rejected, does not throw', () => {
  const crypto = require('node:crypto');
  function b64url(buf){return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  const p = b64url(Buffer.from('null'));
  const sig = b64url(crypto.createHmac('sha256','sig').update(p).digest());
  assert.strictEqual(verifyToken(`${p}.${sig}`, 'sig', 10000, 5000), false);
});
