// test/storage.test.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../lib/storage');

let dataDir;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fd-'));
});

async function seedFile(code, id, content, meta) {
  await storage.ensureRoom(dataDir, code);
  await fs.writeFile(path.join(dataDir, code, id), content);
  await storage.addFileMeta(dataDir, code, { id, size: content.length, ...meta }, meta.uploadedAt);
}

test('listFiles returns [] for missing room', async () => {
  assert.deepStrictEqual(await storage.listFiles(dataDir, 'nope12'), []);
});

test('add + list roundtrip, newest first', async () => {
  await seedFile('room12', 'a1', Buffer.from('hello'), { originalName: 'a.txt', mime: 'text/plain', uploadedAt: 100 });
  await seedFile('room12', 'b2', Buffer.from('world!!'), { originalName: 'b.txt', mime: 'text/plain', uploadedAt: 200 });
  const list = await storage.listFiles(dataDir, 'room12');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, 'b2');
  assert.strictEqual(list[0].name, 'b.txt');
  assert.strictEqual(list[1].size, 5);
});

test('getFile returns path + name, null when absent', async () => {
  await seedFile('room12', 'a1', Buffer.from('hello'), { originalName: 'a.txt', mime: 'text/plain', uploadedAt: 100 });
  const f = await storage.getFile(dataDir, 'room12', 'a1');
  assert.strictEqual(f.name, 'a.txt');
  assert.strictEqual((await fs.readFile(f.path)).toString(), 'hello');
  assert.strictEqual(await storage.getFile(dataDir, 'room12', 'zz'), null);
});

test('deleteFile removes file and meta', async () => {
  await seedFile('room12', 'a1', Buffer.from('hello'), { originalName: 'a.txt', mime: 'text/plain', uploadedAt: 100 });
  assert.strictEqual(await storage.deleteFile(dataDir, 'room12', 'a1'), true);
  assert.deepStrictEqual(await storage.listFiles(dataDir, 'room12'), []);
  await assert.rejects(fs.access(path.join(dataDir, 'room12', 'a1')));
});

test('clearRoom removes the whole room', async () => {
  await seedFile('room12', 'a1', Buffer.from('hello'), { originalName: 'a.txt', mime: 'text/plain', uploadedAt: 100 });
  await storage.clearRoom(dataDir, 'room12');
  await assert.rejects(fs.access(path.join(dataDir, 'room12')));
});

test('concurrent addFileMeta calls do not lose entries', async () => {
  await storage.ensureRoom(dataDir, 'race12');
  const ids = Array.from({ length: 20 }, (_, i) => 'id' + i);
  await Promise.all(ids.map((id, i) =>
    storage.addFileMeta(dataDir, 'race12', { id, originalName: id + '.txt', size: 1, mime: 'text/plain' }, 100 + i)
  ));
  const list = await storage.listFiles(dataDir, 'race12');
  assert.strictEqual(list.length, 20);
});
