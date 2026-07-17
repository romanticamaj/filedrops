// test/qr.test.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../app');

let agent;
beforeEach(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fd-'));
  agent = request.agent(createApp({
    accessPassphrase: 'pw', cookieSecret: 'sig',
    cookieMaxAgeMs: 60000, dataDir, maxFileBytes: 1024 * 1024,
    secureCookie: false,
  }));
  await agent.post('/gate').type('form').send({ passphrase: 'pw' });
});

test('qr endpoint returns a png data url', async () => {
  const res = await agent.get('/r/room12/qr').set('Host', 'drop.example.com');
  assert.strictEqual(res.status, 200);
  assert.match(res.body.dataUrl, /^data:image\/png;base64,/);
});
