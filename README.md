# filedrops

A self-hosted, room-based **ephemeral file relay** behind a single site-wide
passphrase. Walk up to any computer, open a URL, enter the passphrase, and move
files between machines in both directions — no accounts, no OAuth, no database.
Runs as a persistent service on a Windows host. Reach it over the local network,
a Tailscale tailnet, or the public internet via Cloudflare Tunnel (see
[Access modes](#access-modes)).

**Typical use:** at a client site → open the room URL on the on-site PC → enter
the passphrase → drag a file → your own laptop (in the same room) sees it and
downloads it. Reverse works too; hand someone the passphrase to let them upload.

## How it works

- **One passphrase gate** protects the whole tool. Passing it sets a long-lived
  HMAC-signed cookie (`fd_auth`), so your own devices only ask once.
- A **room** is just a folder on disk: `DATA_DIR/<room-code>/`. Open
  `/r/<code>` and everyone on that URL sees the same files.
- **No realtime infra** — the room page polls the file list every 4 seconds.
- **Filesystem is the only store.** No database, no Redis. Each room folder holds
  the uploaded files (named by a random server-generated id) plus a `.meta.json`
  mapping id → original name/size/mime/time.

## Run locally

```bash
npm install
cp .env.example .env   # set ACCESS_PASSPHRASE and COOKIE_SECRET (and SECURE_COOKIE=false for http testing)
npm start
```

Open http://localhost:3000 → enter the passphrase → create a room or open a
fixed room URL (`/r/<your-code>`). Drag files in; the other side sees them within
~4s.

> Local http testing: browsers withhold `Secure` cookies over plain http, so set
> `SECURE_COOKIE=false` when testing on `http://localhost`. In production (behind
> Cloudflare's HTTPS) leave it `true`.

## Usage

- **Create a room:** click *建立新房間* → you're redirected to `/r/<random-code>`.
- **Fixed personal room:** just visit `/r/<your-own-code>` (e.g. `/r/gary-7x2`).
  Memorize one URL and type it on any computer — no code to transfer.
- **Share the room URL / QR:** the room header shows a QR of the current room URL.
  Scanning it (or opening the URL) on a logged-out device lands on the passphrase
  page and then goes **straight into that room** — you don't get bounced to the
  home page. Sharing with someone else = give them the passphrase + the room URL.
- **Manage files:** per-file *刪除*, or *清空房間* to wipe the whole room.

## Room lifecycle

- Files persist until you delete them or clear the room — nothing auto-expires
  while a room still has files.
- An **empty** room whose folder has been idle longer than `ROOM_IDLE_DAYS`
  (default 7) is removed by an hourly cleanup pass. Rooms with files are never
  auto-removed.

## Access modes

filedrops is just an HTTP server on `localhost:PORT`. A tunnel is only **one** way
to reach it — pick the mode that fits who needs access and from where. The server
listens on all interfaces, so modes 1 and 2 need no extra software on the host.

**1. Same network / on-site — no tunnel, no internet.**
Run it on your laptop on any Wi-Fi (home, coworking space, a client's office).
Any device on the same network opens `http://<host-ip>:PORT` (find the host IP
with `ipconfig` on Windows / `ip addr` on Linux). Nothing leaves the local
network — ideal for moving files around on-site with no internet at all. Bring
the laptop, join the client's Wi-Fi, and everyone on it can transfer through you.

**2. Your own devices, anywhere — Tailscale, no tunnel.**
If your machines share a [Tailscale](https://tailscale.com) tailnet, any of them
reaches `http://<tailscale-ip>:PORT` from anywhere (even on cellular), with no
public domain and no tunnel. Best when both ends are *your* devices — e.g. your
phone and your work laptop at a client site.

**3. Anyone with the passphrase — Cloudflare Tunnel, public.**
To let someone who is *not* on your LAN or tailnet reach it from any browser,
expose it publicly at your own domain with Cloudflare Tunnel (see
[Deploy on Windows](#deploy-on-windows-persistent)). This is the only mode that
needs a tunnel.

> **Firewall — host only, and only for LAN mode.** Connecting devices *never* need
> a firewall change; they only make outbound requests. Only the **host** (the
> machine running filedrops) may need to allow inbound on the port, and only in
> mode 1 (LAN). Windows usually pops an "Allow access" prompt the first time the
> server listens — accept it for **Private** networks. If a client's Wi-Fi is
> treated as **Public** and the connection is blocked, add the rule manually
> (elevated):
> `netsh advfirewall firewall add rule name="filedrops" dir=in action=allow protocol=TCP localport=PORT`
> Cloudflare Tunnel needs no inbound rule at all (cloudflared dials outward), and
> Tailscale usually works without one too.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Local listen port |
| `ACCESS_PASSPHRASE` | (required) | Site-wide gate passphrase |
| `COOKIE_SECRET` | (required) | HMAC secret for the auth cookie |
| `DATA_DIR` | ./data | Where room folders live |
| `MAX_FILE_MB` | 2048 | Per-file upload cap |
| `ROOM_IDLE_DAYS` | 7 | Empty rooms older than this are auto-removed |
| `COOKIE_MAX_AGE_DAYS` | 90 | Auth cookie lifetime |
| `SECURE_COOKIE` | true | Marks the auth cookie `Secure` (HTTPS-only); set `false` only for local http testing |

## Deploy on Windows (persistent)

### 1. Cloudflare Tunnel

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create filedrops
```

Create `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: filedrops
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: drop.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Route DNS and install the tunnel as a service:

```powershell
cloudflared tunnel route dns filedrops drop.example.com
cloudflared service install
```

### 2. Node app as a Windows service (nssm)

```powershell
winget install nssm
nssm install filedrops "C:\Program Files\nodejs\node.exe" "D:\projects\filedrops\server.js"
nssm set filedrops AppDirectory "D:\projects\filedrops"
nssm set filedrops AppEnvironmentExtra ACCESS_PASSPHRASE=your-passphrase COOKIE_SECRET=your-random-secret DATA_DIR=D:\projects\filedrops\data
nssm start filedrops
```

Values set via `nssm set filedrops AppEnvironmentExtra ...` (the passphrase and
cookie secret) are stored in the Windows registry and readable via
`nssm dump filedrops` by anyone with admin on the box — treat them as secrets and
restrict admin access.

Both services now start on boot and restart on crash. Verify by visiting
https://drop.example.com — it should prompt for the passphrase over HTTPS.

## Security notes

- The passphrase gate protects the whole tool; the `noindex` header + robots.txt
  keep it out of search engines. Sharing a room = sharing the passphrase + room URL.
- Room codes are unguessable random strings; each recipient only sees the room
  URL you send them.
- The passphrase gate is protected by a lightweight in-memory rate limit
  (10 attempts / 5 min / IP) and uploads by 60 / min / IP; for stronger protection
  add a Cloudflare WAF rate-limit rule on `drop.example.com`.
- Uploaded files are stored under a random server-generated id, never the
  user-supplied filename, so a malicious name can't escape `DATA_DIR`. The post-
  login redirect only accepts same-site paths (no open redirect).

## Testing

```bash
npm test        # node --test — 48 tests, no external services
```

## Project layout

```
server.js          entry: load config, create app, hourly cleanup, listen
app.js             createApp(config): gate, requireAuth, static, error handler
routes/rooms.js    roomsRouter(config): create/list/upload/download/delete/clear/qr
lib/config.js      env → config object
lib/auth.js        constant-time passphrase check + HMAC signed cookie
lib/rooms.js       room-code generation + path-traversal-safe roomDir()
lib/storage.js     per-room .meta.json + file lifecycle (serialized writes)
lib/cleanup.js     idle empty-room removal
lib/ratelimit.js   tiny in-memory per-IP limiter
public/            gate.html, index.html, room.html, app.js (client)
test/              node:test suites (one per module + route/gate/qr)
docs/              design spec, implementation plan, build-harness spec
```
