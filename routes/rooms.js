// routes/rooms.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const storage = require('../lib/storage');
const { generateRoomCode, isValidRoomCode } = require('../lib/rooms');
const { rateLimiter } = require('../lib/ratelimit');
const { LANGS, DICT, t, render, pickLang, switchHref } = require('../lib/i18n');

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// multer 1.x (busboy) decodes multipart filenames as latin1; reinterpret those
// bytes as UTF-8 when they form a valid UTF-8 sequence. No-op for pure ASCII.
function decodeOriginalName(name) {
  const buf = Buffer.from(name, 'latin1');
  const utf8 = buf.toString('utf8');
  return Buffer.from(utf8, 'utf8').equals(buf) ? utf8 : name;
}

function roomsRouter(config) {
  const router = express.Router();
  const langCookie = config.langCookie || 'fd_lang';

  // lang -> { index, room }: both app pages are rendered once per language at
  // boot. The dictionary the client script needs at runtime is inlined as a
  // JSON island ({{@dict}}), so the page never fetches translations. Editing
  // the HTML templates now needs a server restart to show up.
  const PAGES = {};
  for (const lang of LANGS) {
    const dict = JSON.stringify(DICT[lang]).replace(/</g, '\\u003c');
    PAGES[lang] = {};
    for (const name of ['index', 'room']) {
      const tpl = fs.readFileSync(path.join(__dirname, '..', 'public', `${name}.html`), 'utf8');
      PAGES[lang][name] = render(tpl, lang).replace('{{@dict}}', () => dict);
    }
  }

  // {{@switchhref}} is per request: the switcher links to the URL the visitor
  // is on, with ?lang= set to the other language.
  const page = (req, name) => {
    const lang = pickLang(req, langCookie);
    return PAGES[lang][name].replace('{{@switchhref}}', () => switchHref(req.originalUrl, lang));
  };

  const notFound = (req, res) => res.status(404).send(t(pickLang(req, langCookie), 'err.notfound'));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const uploadLimiter = rateLimiter({ windowMs: 60 * 1000, max: 60 });

  const upload = multer({
    limits: { fileSize: config.maxFileBytes },
    storage: multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          const dir = await storage.ensureRoom(config.dataDir, req.params.code);
          cb(null, dir);
        } catch (e) { cb(e); }
      },
      filename: (req, file, cb) => {
        const id = storage.newFileId();
        file._fdId = id;
        cb(null, id);
      },
    }),
  });

  const validCode = (req, res, next) => {
    if (!isValidRoomCode(req.params.code)) return notFound(req, res);
    next();
  };

  router.get('/', (req, res) => res.type('html').send(page(req, 'index')));

  router.post('/new', (req, res) => res.redirect(`/r/${generateRoomCode()}`));

  router.get('/r/:code', validCode, (req, res) =>
    res.type('html').send(page(req, 'room')));

  router.get('/r/:code/list', validCode, wrap(async (req, res) => {
    res.json({ files: await storage.listFiles(config.dataDir, req.params.code) });
  }));

  router.post('/r/:code/upload', uploadLimiter, validCode, upload.array('files'), wrap(async (req, res) => {
    for (const f of req.files || []) {
      await storage.addFileMeta(config.dataDir, req.params.code, {
        id: f._fdId, originalName: decodeOriginalName(f.originalname), size: f.size, mime: f.mimetype,
      });
    }
    if (req.accepts(['html', 'json']) === 'json') return res.json({ ok: true });
    res.redirect(`/r/${req.params.code}`);
  }));

  router.get('/r/:code/file/:id', validCode, wrap(async (req, res) => {
    const f = await storage.getFile(config.dataDir, req.params.code, req.params.id);
    if (!f) return notFound(req, res);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', contentDisposition(f.name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(f.path);
  }));

  router.post('/r/:code/delete/:id', validCode, wrap(async (req, res) => {
    await storage.deleteFile(config.dataDir, req.params.code, req.params.id);
    if (req.accepts(['html', 'json']) === 'json') return res.json({ ok: true });
    res.redirect(`/r/${req.params.code}`);
  }));

  router.post('/r/:code/clear', validCode, wrap(async (req, res) => {
    await storage.clearRoom(config.dataDir, req.params.code);
    if (req.accepts(['html', 'json']) === 'json') return res.json({ ok: true });
    res.redirect('/');
  }));

  router.get('/r/:code/qr', validCode, wrap(async (req, res) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const url = `${proto}://${req.headers.host}/r/${req.params.code}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    res.json({ dataUrl });
  }));

  return router;
}

module.exports = { roomsRouter };
