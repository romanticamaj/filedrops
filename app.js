// app.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const { checkPassphrase, signToken, verifyToken } = require('./lib/auth');
const { rateLimiter } = require('./lib/ratelimit');

const COOKIE = 'fd_auth';
const GATE_HTML = fs.readFileSync(path.join(__dirname, 'public', 'gate.html'), 'utf8');
const GATE_HTML_ERR = GATE_HTML.replace('<div class="err" id="err"></div>', '<div class="err" id="err">通關碼錯誤</div>');
const FORM_TAG = '<form method="POST" action="/gate">';

// Only allow same-site absolute paths (no protocol-relative //, no scheme) as a
// post-login destination — prevents the gate being abused as an open redirect.
function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (!/^\/[A-Za-z0-9/_\-.%?=&]*$/.test(next)) return '/';
  return next;
}

// Render the gate page, carrying the intended destination through as a hidden field.
function gatePage(dest, withError) {
  const base = withError ? GATE_HTML_ERR : GATE_HTML;
  if (!dest || dest === '/') return base;
  const escaped = dest.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return base.replace(FORM_TAG, `${FORM_TAG}<input type="hidden" name="next" value="${escaped}">`);
}

function createApp(config) {
  const app = express();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    next();
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/gate', (req, res) => {
    res.type('html').send(gatePage(safeNext(req.query.next), false));
  });

  const gateLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });
  app.post('/gate', gateLimiter, (req, res) => {
    const dest = safeNext(req.body.next);
    if (!checkPassphrase(req.body.passphrase || '', config.accessPassphrase)) {
      return res.status(401).type('html').send(gatePage(dest, true));
    }
    res.cookie(COOKIE, signToken(config.cookieSecret), {
      httpOnly: true, sameSite: 'lax', secure: config.secureCookie !== false, maxAge: config.cookieMaxAgeMs,
    });
    res.redirect(dest);
  });

  app.post('/logout', (req, res) => {
    res.clearCookie(COOKIE);
    res.redirect('/gate');
  });

  const requireAuth = (req, res, next) => {
    if (verifyToken(req.cookies[COOKIE], config.cookieSecret, config.cookieMaxAgeMs)) return next();
    // Preserve the room the visitor was heading to (e.g. from a scanned QR) so
    // login returns them straight there instead of the home page.
    const isRoomPage = req.method === 'GET' && /^\/r\/[a-z0-9-]{3,32}$/.test(req.path);
    res.redirect(isRoomPage ? `/gate?next=${encodeURIComponent(req.path)}` : '/gate');
  };
  app.use(requireAuth);

  app.use(express.static(path.join(__dirname, 'public'), { index: false }));

  const { roomsRouter } = require('./routes/rooms');
  app.use(roomsRouter(config));

  app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).send('file too large');
    console.error(err);
    res.status(500).send('server error');
  });

  return app;
}

module.exports = { createApp, COOKIE };
