// lib/config.js
const path = require('path');

function required(env, name) {
  const v = env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function num(env, name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
}

function loadConfig(env = process.env) {
  const maxFileMb = num(env, 'MAX_FILE_MB', 2048);
  const roomIdleDays = num(env, 'ROOM_IDLE_DAYS', 7);
  const cookieMaxAgeDays = num(env, 'COOKIE_MAX_AGE_DAYS', 90);
  return {
    port: num(env, 'PORT', 3000),
    accessPassphrase: required(env, 'ACCESS_PASSPHRASE'),
    cookieSecret: required(env, 'COOKIE_SECRET'),
    dataDir: path.resolve(env.DATA_DIR || path.join(process.cwd(), 'data')),
    maxFileBytes: maxFileMb * 1024 * 1024,
    roomIdleDays,
    cookieMaxAgeMs: cookieMaxAgeDays * 24 * 60 * 60 * 1000,
    secureCookie: env.SECURE_COOKIE !== 'false',
    langCookie: env.LANG_COOKIE || 'fd_lang',
    langCookieDomain: env.LANG_COOKIE_DOMAIN || undefined,
  };
}

module.exports = { loadConfig };
