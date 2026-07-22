// lib/i18n.js
// One flat JSON file per language, one render() that substitutes {{key}}
// placeholders, one language picker. No dependency: require() of a JSON file
// is the whole loader.
//
// Pages are rendered per language once, at boot, and the finished document is
// what reaches the browser. No client fetch, no flash of untranslated text,
// and every string is present with JavaScript switched off, which is the
// gate's hard constraint (it is served before auth as one self-contained
// file).
const LANGS = ['en', 'zh-Hant'];
const DEFAULT = 'en';
const DICT = {
  en: require('../locales/en.json'),
  'zh-Hant': require('../locales/zh-Hant.json'),
};

// Requested language, then English, then the key itself. Returning the key
// rather than '' makes a missing string loud on screen and greppable in a
// screenshot; test/i18n.test.js asserts key parity, so it should never fire.
function t(lang, key) {
  return DICT[lang]?.[key] ?? DICT[DEFAULT][key] ?? key;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

// {{some.key}} resolves here, at boot. {{@name}} is a per-request placeholder
// and the leading @ keeps it out of this regex on purpose, so the boot pass
// walks straight past it. Every substituted value is escaped, so a future
// translation cannot become an injection.
function render(tpl, lang) {
  return tpl.replace(/\{\{([a-z0-9.]+)\}\}/gi, (m, key) => escapeHtml(t(lang, key)));
}

// Deliberately narrow. We ship no Simplified Chinese, and handing a
// Simplified reader a Traditional page is a worse guess than handing them
// English; the switcher is one click away either way.
// ponytail: read left to right, q weights ignored. Upgrade path: sort by q.
function fromAccept(header) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase();
    if (tag === '*' || tag === 'en' || tag.startsWith('en-')) return 'en';
    if (tag === 'zh-hans' || tag === 'zh-cn' || tag === 'zh-sg') continue;
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-Hant';
  }
  return null;
}

// Highest first: ?lang=, then the cookie, then Accept-Language, then English.
// An unrecognised value at any rung falls through instead of erroring. The
// value is never interpolated into HTML, only used to select a precomputed
// variant by key, so it cannot become an injection on a pre-auth page.
function pickLang(req, cookieName) {
  const q = req.query && req.query.lang;
  if (LANGS.includes(q)) return q;
  const c = req.cookies && req.cookies[cookieName];
  if (LANGS.includes(c)) return c;
  return fromAccept(req.get && req.get('accept-language')) || DEFAULT;
}

const otherLang = (lang) => (lang === 'zh-Hant' ? 'en' : 'zh-Hant');

// The switcher is a plain anchor, because a link is the only switcher that
// works with JavaScript disabled. Returns an attribute-safe href pointing at
// the same URL with ?lang= set to the other language.
function switchHref(base, lang) {
  const url = new URL(base || '/', 'http://placeholder.invalid');
  url.searchParams.set('lang', otherLang(lang));
  return escapeHtml(url.pathname + url.search);
}

module.exports = { LANGS, DEFAULT, DICT, t, render, escapeHtml, fromAccept, pickLang, otherLang, switchHref };
