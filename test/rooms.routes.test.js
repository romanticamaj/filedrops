// test/rooms.routes.test.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../app');
const { signToken } = require('../lib/auth');

let config, agent;
beforeEach(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fd-'));
  config = {
    accessPassphrase: 'pw', cookieSecret: 'sig',
    cookieMaxAgeMs: 60000, dataDir, maxFileBytes: 1024 * 1024,
    secureCookie: false,
  };
  agent = request.agent(createApp(config));
  await agent.post('/gate').type('form').send({ passphrase: 'pw' });
});

test('POST /new redirects to a room url', async () => {
  const res = await agent.post('/new');
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.location, /^\/r\/[a-z0-9-]{3,32}$/);
});

test('GET /r/:code rejects invalid code with 404', async () => {
  const res = await agent.get('/r/../secret');
  assert.strictEqual(res.status, 404);
});

test('upload then list then download roundtrip', async () => {
  const up = await agent
    .post('/r/room12/upload')
    .attach('files', Buffer.from('hello world'), 'greeting.txt');
  assert.ok(up.status === 302 || up.status === 200);

  const list = await agent.get('/r/room12/list');
  assert.strictEqual(list.body.files.length, 1);
  const id = list.body.files[0].id;
  assert.strictEqual(list.body.files[0].name, 'greeting.txt');

  const dl = await agent.get(`/r/room12/file/${id}`);
  assert.strictEqual(dl.status, 200);
  assert.strictEqual(dl.text, 'hello world');
  assert.match(dl.headers['content-disposition'], /greeting\.txt/);
});

test('delete removes a file', async () => {
  await agent.post('/r/room12/upload').attach('files', Buffer.from('x'), 'a.txt');
  const id = (await agent.get('/r/room12/list')).body.files[0].id;
  await agent.post(`/r/room12/delete/${id}`);
  assert.strictEqual((await agent.get('/r/room12/list')).body.files.length, 0);
});

test('clear empties the room', async () => {
  await agent.post('/r/room12/upload').attach('files', Buffer.from('x'), 'a.txt');
  await agent.post('/r/room12/clear');
  assert.strictEqual((await agent.get('/r/room12/list')).body.files.length, 0);
});

test('download 404 for unknown id', async () => {
  const res = await agent.get('/r/room12/file/deadbeef');
  assert.strictEqual(res.status, 404);
});

test('invalid room code (too short) is 404 via validCode', async () => {
  const res = await agent.get('/r/ab');
  assert.strictEqual(res.status, 404);
});

test('CJK filename survives upload, list, and download', async () => {
  const name = '客戶報告 2026.txt';
  await agent.post('/r/room12/upload').attach('files', Buffer.from('hi'), name);
  const list = await agent.get('/r/room12/list');
  assert.strictEqual(list.body.files[0].name, name);
  const dl = await agent.get(`/r/room12/file/${list.body.files[0].id}`);
  assert.match(dl.headers['content-disposition'], /filename\*=UTF-8''%E5%AE%A2%E6%88%B6%E5%A0%B1%E5%91%8A/);
});

test('over-limit upload returns 413', async () => {
  const os = require('node:os');
  const small = await fs.mkdtemp(path.join(os.tmpdir(), 'fd-'));
  const a = request.agent(createApp({
    accessPassphrase: 'pw', cookieSecret: 'sig',
    cookieMaxAgeMs: 60000, dataDir: small, maxFileBytes: 5, secureCookie: false,
  }));
  await a.post('/gate').type('form').send({ passphrase: 'pw' });
  const res = await a.post('/r/room12/upload').attach('files', Buffer.from('hello world'), 'a.txt');
  assert.strictEqual(res.status, 413);
});
