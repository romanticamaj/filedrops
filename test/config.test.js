// test/config.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../lib/config');

const base = { ACCESS_PASSPHRASE: 'secret', COOKIE_SECRET: 'sig' };

test('loads defaults when only required vars are set', () => {
  const cfg = loadConfig(base);
  assert.strictEqual(cfg.port, 3000);
  assert.strictEqual(cfg.maxFileBytes, 2048 * 1024 * 1024);
  assert.strictEqual(cfg.roomIdleDays, 7);
  assert.strictEqual(cfg.cookieMaxAgeMs, 90 * 24 * 60 * 60 * 1000);
  assert.strictEqual(cfg.accessPassphrase, 'secret');
});

test('overrides from env', () => {
  const cfg = loadConfig({ ...base, PORT: '4000', MAX_FILE_MB: '10', ROOM_IDLE_DAYS: '3' });
  assert.strictEqual(cfg.port, 4000);
  assert.strictEqual(cfg.maxFileBytes, 10 * 1024 * 1024);
  assert.strictEqual(cfg.roomIdleDays, 3);
});

test('throws when ACCESS_PASSPHRASE missing', () => {
  assert.throws(() => loadConfig({ COOKIE_SECRET: 'sig' }), /ACCESS_PASSPHRASE/);
});

test('throws when COOKIE_SECRET missing', () => {
  assert.throws(() => loadConfig({ ACCESS_PASSPHRASE: 'secret' }), /COOKIE_SECRET/);
});

test('secureCookie defaults true, disabled by SECURE_COOKIE=false', () => {
  assert.strictEqual(loadConfig(base).secureCookie, true);
  assert.strictEqual(loadConfig({ ...base, SECURE_COOKIE: 'false' }).secureCookie, false);
});
