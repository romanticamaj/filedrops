// server.js
const fs = require('fs');
const { loadConfig } = require('./lib/config');
const { createApp } = require('./app');
const { cleanupIdleRooms } = require('./lib/cleanup');
const { reachableUrls } = require('./lib/addresses');

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });

const app = createApp(config);
app.set('trust proxy', 'loopback'); // cloudflared is a single loopback hop; prevents X-Forwarded-For spoofing

const HOUR = 60 * 60 * 1000;
setInterval(() => {
  cleanupIdleRooms(config.dataDir, config.roomIdleDays).catch((e) => console.error('cleanup failed', e));
}, HOUR).unref();

app.listen(config.port, () => {
  const urls = reachableUrls(config.port);
  const pad = Math.max(...urls.map((u) => u.label.length));
  console.log('\nfiledrops is running — open one of these (passphrase required):\n');
  for (const { label, url } of urls) {
    console.log(`  ${label.padEnd(pad)}   ${url}`);
  }
  console.log('\nShare the Network or Tailscale URL — not localhost — so other devices can reach it.\n');
});
