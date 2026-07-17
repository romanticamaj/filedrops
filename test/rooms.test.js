// test/rooms.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { generateRoomCode, isValidRoomCode, roomDir } = require('../lib/rooms');

test('generated code has requested length and safe alphabet', () => {
  const code = generateRoomCode(6);
  assert.strictEqual(code.length, 6);
  assert.match(code, /^[abcdefghjkmnpqrstvwxyz23456789]{6}$/);
});

test('generated codes are valid room codes', () => {
  assert.strictEqual(isValidRoomCode(generateRoomCode()), true);
});

test('isValidRoomCode accepts custom slugs, rejects junk', () => {
  assert.strictEqual(isValidRoomCode('gary-7x2'), true);
  assert.strictEqual(isValidRoomCode('ab'), false);       // too short
  assert.strictEqual(isValidRoomCode('has space'), false);
  assert.strictEqual(isValidRoomCode('../etc'), false);
  assert.strictEqual(isValidRoomCode('UPPER'), false);
});

test('roomDir returns path inside dataDir', () => {
  const dir = roomDir('/data', 'gary-7x2');
  assert.strictEqual(dir, path.resolve('/data', 'gary-7x2'));
});

test('roomDir throws on traversal or invalid code', () => {
  assert.throws(() => roomDir('/data', '../secret'), /invalid room code/);
  assert.throws(() => roomDir('/data', 'bad/../../x'), /invalid room code/);
});
