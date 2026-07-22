// test/gate.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../app');

const config = {
  accessPassphrase: 'open-sesame',
  cookieSecret: 'sig',
  cookieMaxAgeMs: 1000 * 60,
  dataDir: require('os').tmpdir(),
  maxFileBytes: 1024 * 1024,
  secureCookie: false,
};
const app = createApp(config);

test('unauthenticated request to / redirects to /gate', async () => {
  const res = await request(app).get('/');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/gate');
});

test('every response carries noindex header', async () => {
  const res = await request(app).get('/gate');
  assert.strictEqual(res.headers['x-robots-tag'], 'noindex');
});

test('robots.txt disallows all', async () => {
  const res = await request(app).get('/robots.txt');
  assert.match(res.text, /Disallow: \//);
});

test('wrong passphrase is rejected, no cookie set', async () => {
  const res = await request(app).post('/gate').type('form').send({ passphrase: 'nope' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.headers['set-cookie'], undefined);
});

test('correct passphrase sets cookie and unlocks /', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/gate').type('form').send({ passphrase: 'open-sesame' });
  assert.strictEqual(login.status, 302);
  assert.strictEqual(login.headers.location, '/');
  const home = await agent.get('/');
  assert.strictEqual(home.status, 200);
});

test('logout clears the cookie', async () => {
  const agent = request.agent(app);
  await agent.post('/gate').type('form').send({ passphrase: 'open-sesame' });
  await agent.post('/logout');
  const res = await agent.get('/');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/gate');
});

test('wrong passphrase page shows the error message (English default)', async () => {
  const res = await request(app).post('/gate').type('form').send({ passphrase: 'nope' });
  assert.strictEqual(res.status, 401);
  assert.match(res.text, /Wrong passphrase/);
});

test('wrong passphrase page answers in the language the form posted', async () => {
  const res = await request(app).post('/gate').type('form').send({ passphrase: 'nope', lang: 'zh-Hant' });
  assert.strictEqual(res.status, 401);
  assert.match(res.text, /通關碼錯誤/);
});

test('unauthenticated room page redirects to gate carrying next', async () => {
  const res = await request(app).get('/r/myroom');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/gate?next=%2Fr%2Fmyroom');
});

test('gate page carries next through as a hidden field', async () => {
  const res = await request(app).get('/gate?next=/r/myroom');
  assert.match(res.text, /<input type="hidden" name="next" value="\/r\/myroom">/);
});

test('login returns the user to the next room', async () => {
  const nextApp = createApp({ ...config });
  const agent = request.agent(nextApp);
  const res = await agent.post('/gate').type('form').send({ passphrase: 'open-sesame', next: '/r/myroom' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/r/myroom');
});

test('open-redirect via next is neutralized to /', async () => {
  const nextApp = createApp({ ...config });
  const agent = request.agent(nextApp);
  const res = await agent.post('/gate').type('form').send({ passphrase: 'open-sesame', next: '//evil.com/x' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/');
});

test('gate rate-limits repeated attempts with 429', async () => {
  const freshApp = createApp({
    accessPassphrase: 'open-sesame', cookieSecret: 'sig',
    cookieMaxAgeMs: 60000, dataDir: require('os').tmpdir(), maxFileBytes: 1024, secureCookie: false,
  });
  let last;
  for (let i = 0; i < 12; i++) {
    last = await request(freshApp).post('/gate').type('form').send({ passphrase: 'nope' });
  }
  assert.strictEqual(last.status, 429);
});
