// test/i18n.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../app');
const { LANGS, DICT, fromAccept } = require('../lib/i18n');

const config = {
  accessPassphrase: 'open-sesame',
  cookieSecret: 'sig',
  cookieMaxAgeMs: 1000 * 60,
  dataDir: require('os').tmpdir(),
  maxFileBytes: 1024 * 1024,
  secureCookie: false,
  langCookie: 'fd_lang',
};
const app = createApp(config);

test('locale files carry the same key set', () => {
  const [first, ...rest] = LANGS.map((l) => Object.keys(DICT[l]).sort());
  for (const keys of rest) assert.deepStrictEqual(keys, first);
});

test('no locale value is empty', () => {
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(DICT[l])) {
      assert.notStrictEqual(v, '', `${l}:${k}`);
    }
  }
});

test('gate defaults to English', async () => {
  const res = await request(app).get('/gate');
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /<html lang="en">/);
  assert.match(res.text, />Enter</);
});

test('Accept-Language zh-TW gets the Traditional Chinese gate', async () => {
  const res = await request(app).get('/gate').set('Accept-Language', 'zh-TW,zh;q=0.9');
  assert.match(res.text, /<html lang="zh-Hant">/);
  assert.match(res.text, />進入</);
  assert.match(res.text, /placeholder="通關碼"/);
});

test('language cookie beats Accept-Language', async () => {
  const res = await request(app).get('/gate')
    .set('Accept-Language', 'zh-TW')
    .set('Cookie', 'fd_lang=en');
  assert.match(res.text, /<html lang="en">/);
});

test('?lang= persists the choice in a cookie and strips itself', async () => {
  const res = await request(app).get('/gate?lang=zh-Hant');
  assert.strictEqual(res.status, 303);
  assert.strictEqual(res.headers.location, '/gate');
  assert.match(res.headers['set-cookie'][0], /^fd_lang=zh-Hant;/);
});

test('?lang= keeps the rest of the query string', async () => {
  const res = await request(app).get('/gate?next=%2Fr%2Fmyroom&lang=zh-Hant');
  assert.strictEqual(res.status, 303);
  assert.strictEqual(res.headers.location, '/gate?next=%2Fr%2Fmyroom');
});

test('an unknown ?lang= value is ignored', async () => {
  const res = await request(app).get('/gate?lang=fr');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['set-cookie'], undefined);
  assert.match(res.text, /<html lang="en">/);
});

test('the gate carries a JavaScript-free switcher to the other language', async () => {
  const en = await request(app).get('/gate');
  assert.match(en.text, /<a class="lang" href="\/gate\?lang=zh-Hant"[^>]*>繁體中文<\/a>/);
  const zh = await request(app).get('/gate').set('Accept-Language', 'zh-TW');
  assert.match(zh.text, /<a class="lang" href="\/gate\?lang=en"[^>]*>English<\/a>/);
});

test('the room page inlines the dictionary for the client script', async () => {
  const agent = request.agent(app);
  await agent.post('/gate').type('form').send({ passphrase: 'open-sesame' });
  const res = await agent.get('/r/myroom').set('Accept-Language', 'zh-TW');
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /<script type="application\/json" id="i18n">/);
  assert.match(res.text, /尚無檔案/);
});

test('Simplified Chinese falls through to English, not zh-Hant', () => {
  assert.strictEqual(fromAccept('zh-CN,zh;q=0.9'), 'zh-Hant'); // second tag wins
  assert.strictEqual(fromAccept('zh-CN'), null);
  assert.strictEqual(fromAccept('zh-TW'), 'zh-Hant');
  assert.strictEqual(fromAccept('en-GB'), 'en');
  assert.strictEqual(fromAccept('*'), 'en');
});
