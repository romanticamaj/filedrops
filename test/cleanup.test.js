// test/cleanup.test.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../lib/storage');
const { cleanupIdleRooms } = require('../lib/cleanup');

const DAY = 24 * 60 * 60 * 1000;
let dataDir;
beforeEach(async () => { dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fd-')); });

async function setMtime(code, when) {
  const t = new Date(when);
  await fs.utimes(path.join(dataDir, code), t, t);
}

test('removes empty rooms older than idleDays', async () => {
  await storage.ensureRoom(dataDir, 'oldrm1');
  await setMtime('oldrm1', 0); // epoch, very old
  const removed = await cleanupIdleRooms(dataDir, 7, 30 * DAY);
  assert.deepStrictEqual(removed, ['oldrm1']);
  await assert.rejects(fs.access(path.join(dataDir, 'oldrm1')));
});

test('keeps empty rooms within idle window', async () => {
  await storage.ensureRoom(dataDir, 'newrm1');
  await setMtime('newrm1', 29 * DAY);
  const removed = await cleanupIdleRooms(dataDir, 7, 30 * DAY);
  assert.deepStrictEqual(removed, []);
});

test('keeps old rooms that still have files', async () => {
  await storage.ensureRoom(dataDir, 'keeprm');
  await fs.writeFile(path.join(dataDir, 'keeprm', 'abc'), 'x');
  await storage.addFileMeta(dataDir, 'keeprm', { id: 'abc', originalName: 'a.txt', size: 1, mime: 'text/plain' }, 100);
  await setMtime('keeprm', 0);
  const removed = await cleanupIdleRooms(dataDir, 7, 30 * DAY);
  assert.deepStrictEqual(removed, []);
});
