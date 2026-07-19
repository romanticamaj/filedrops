# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

filedrops — a self-hosted, room-based ephemeral file relay behind one site-wide
passphrase. No accounts, no database. Node.js + Express, runs as a persistent
Windows service exposed via Cloudflare Tunnel. See `README.md` for user-facing
docs and `docs/filedrops-harness.md` for the original build spec.

## Commands

```bash
npm install
npm test        # node --test  (built-in runner; do NOT add Jest/Vitest/Mocha)
npm start       # runs server.js; needs ACCESS_PASSPHRASE + COOKIE_SECRET in env

# local http run (browsers withhold Secure cookies over http):
ACCESS_PASSPHRASE=test COOKIE_SECRET=dev SECURE_COOKIE=false PORT=3000 node server.js
```

## Hard constraints (do not violate)

- **No database.** The filesystem under `DATA_DIR` is the only persistence.
- **No accounts / OAuth.** Exactly one shared passphrase gates the whole app.
- **Runtime deps are frozen:** only `express`, `multer`, `qrcode`, `cookie-parser`.
  Dev dep only: `supertest`. Do not add others without an explicit decision.
- **Tests:** Node built-in `node:test` + `node:assert`, run with `node --test`.
- **Realtime = polling.** No WebSocket/SSE.
- CommonJS (`"type": "commonjs"`), Node 20+.

## Architecture

```
server.js        entry: loadConfig → createApp → app.set('trust proxy','loopback')
                 → hourly cleanupIdleRooms → listen
app.js           createApp(config): cookie-parser, noindex header, /robots.txt,
                 passphrase gate (/gate, /logout), requireAuth, static, rooms router,
                 error middleware. Exports createApp so tests build isolated apps.
routes/rooms.js  roomsRouter(config): /, /new, /r/:code, list, upload, download,
                 delete, clear, qr. async handlers wrapped with wrap() -> next(err).
lib/config.js    env → { port, accessPassphrase, cookieSecret, dataDir, maxFileBytes,
                 roomIdleDays, cookieMaxAgeMs, secureCookie }
lib/auth.js      checkPassphrase (constant-time), signToken/verifyToken (HMAC cookie)
lib/rooms.js     generateRoomCode, isValidRoomCode, roomDir (traversal guard)
lib/storage.js   ensureRoom, newFileId, addFileMeta, listFiles, getFile, deleteFile,
                 clearRoom. Per-room .meta.json; writes serialized via withRoomLock.
lib/cleanup.js   cleanupIdleRooms — removes empty rooms idle > ROOM_IDLE_DAYS
lib/ratelimit.js rateLimiter({windowMs,max}) — in-memory per-IP
lib/addresses.js reachableUrls(port) — Local/Network/Tailscale URLs for the startup banner
public/          gate.html, index.html, room.html, app.js (client: poll, drag-drop, QR)
```

## Invariants worth preserving

- **Path safety:** on-disk filenames are always `newFileId()`, never the user's
  original name (that lives only in `.meta.json`). All room paths go through
  `roomDir()`, which rejects anything escaping `DATA_DIR`. `:code` is validated by
  `isValidRoomCode`; `:id` is safe because `getFile`/`deleteFile` only build a path
  after confirming the id exists as a meta key.
- **Auth:** `verifyToken` must return false (never throw) on any malformed token.
  Cookie is HttpOnly, SameSite=Lax, `secure: config.secureCookie !== false`
  (Secure by default; only off when `SECURE_COOKIE=false`).
- **Gate rate limiting:** `POST /gate` is limited (10 / 5 min / IP → 429); uploads
  60 / min / IP. Keep these when touching the gate.
- **Post-login redirect:** the gate carries a `next` param so a scanned room URL
  returns the user to that room after login. `safeNext()` only allows same-site
  paths — do not loosen it (open-redirect risk).
- **Metadata writes are serialized per room** (`withRoomLock`) to avoid the
  concurrent-upload `.meta.json` clobber race.

## Testing conventions

- TDD: write the failing `node:test` first, then implement.
- Tests build isolated apps via `createApp({...})` and use `supertest`.
- Any test that logs in through `/gate` over http MUST set `secureCookie: false`
  in its config, or the auth cookie won't replay and requests will 302 to /gate.
- Tests use real temp dirs (`fs.mkdtemp(os.tmpdir())`) and assert real behavior
  (byte-identical roundtrips, real fs state) — not mocks.

## Docs

- `docs/filedrops-harness.md` — build-harness spec (constraints + key tech)
- Design spec and task-by-task implementation plan are kept locally under
  `docs/superpowers/` (git-ignored — build-process artifacts, not published).
- Personal deployment specifics (real domain, tunnel id, service commands) live
  in a git-ignored local Claude skill, not in this repo.
