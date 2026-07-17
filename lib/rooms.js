// lib/rooms.js
const crypto = require('crypto');
const path = require('path');

const ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';
const CODE_RE = /^[a-z0-9-]{3,32}$/;

function generateRoomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function isValidRoomCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

function roomDir(dataDir, code) {
  if (!isValidRoomCode(code)) throw new Error('invalid room code');
  const base = path.resolve(dataDir);
  const dir = path.resolve(base, code);
  if (dir !== path.join(base, code) || !dir.startsWith(base + path.sep)) {
    throw new Error('invalid room code');
  }
  return dir;
}

module.exports = { generateRoomCode, isValidRoomCode, roomDir };
