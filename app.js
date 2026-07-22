// app.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const { checkPassphrase, signToken, verifyToken } = require('./lib/auth');
const { rateLimiter } = require('./lib/ratelimit');
const { LANGS, t, render, escapeHtml, pickLang, switchHref } = require('./lib/i18n');

const COOKIE = 'fd_auth';
const GATE_TPL = fs.readFileSync(path.join(__dirname, 'public', 'gate.html'), 'utf8');
const ERR_NEEDLE = '<div class="err" id="err"></div>';
const FORM_TAG = '<form method="POST" action="/gate">';

// lang -> { ok, err }: the gate is rendered once per language at boot, so the
// document a browser receives is already complete in its language and needs
// no JavaScript to show any string.
const GATE = Object.fromEntries(LANGS.map((lang) => {
  const ok = render(GATE_TPL, lang);
  const err = ok.replace(ERR_NEEDLE, `<div class="err" id="err">${escapeHtml(t(lang, 'gate.error.wrong'))}</div>`);
  return [lang, { ok, err }];
}));

// Only allow same-site absolute paths (no protocol-relative //, no scheme) as a
// post-login destination — prevents the gate being abused as an open redirect.
function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (!/^\/[A-Za-z0-9/_\-.%?=&]*$/.test(next)) return '/';
  return next;
}

// Render the gate page, carrying the intended destination through as a hidden field.
function gatePage(lang, dest, withError) {
  const swBase = !dest || dest === '/' ? '/gate' : `/gate?next=${encodeURIComponent(dest)}`;
  const base = (withError ? GATE[lang].err : GATE[lang].ok)
    .replace('{{@switchhref}}', () => switchHref(swBase, lang));
  if (!dest || dest === '/') return base;
  const escaped = dest.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return base.replace(FORM_TAG, `${FORM_TAG}<input type="hidden" name="next" value="${escaped}">`);
}

function createApp(config) {
  const app = express();
  const langCookie = config.langCookie || 'fd_lang';
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    next();
  });

  // ?lang= switches the language for the whole visit: persist the choice in a
  // cookie, then redirect with the parameter stripped, so a copied room URL
  // never carries a sticky language along to whoever it gets pasted to.
  // Sits above requireAuth because switching language on the gate is a
  // pre-auth action, and a link is the only switcher that works without
  // JavaScript.
  app.use((req, res, next) => {
    const q = req.query.lang;
    if (!LANGS.includes(q) || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    res.cookie(langCookie, q, {
      path: '/', maxAge: 31536000000, sameSite: 'lax',
      secure: config.secureCookie !== false, domain: config.langCookieDomain,
    });
    const url = new URL(req.originalUrl, 'http://x');
    url.searchParams.delete('lang');
    res.redirect(303, url.pathname + url.search);
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/gate', (req, res) => {
    res.type('html').send(gatePage(pickLang(req, langCookie), safeNext(req.query.next), false));
  });

  const gateLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });
  app.post('/gate', gateLimiter, (req, res) => {
    // The form carries its own language in a hidden field, so a failed login
    // answers in the language of the form that produced it even when cookies
    // are blocked.
    const lang = LANGS.includes(req.body.lang) ? req.body.lang : pickLang(req, langCookie);
    const dest = safeNext(req.body.next);
    if (!checkPassphrase(req.body.passphrase || '', config.accessPassphrase)) {
      return res.status(401).type('html').send(gatePage(lang, dest, true));
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
    const lang = pickLang(req, langCookie);
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).send(t(lang, 'err.toobig'));
    console.error(err);
    res.status(500).send(t(lang, 'err.server'));
  });

  return app;
}

module.exports = { createApp, COOKIE };
