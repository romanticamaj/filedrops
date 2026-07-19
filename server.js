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
  const shareable = reachableUrls(config.port).filter((u) => u.label !== 'Local');
  console.log('\nfiledrops is running.\n');
  if (shareable.length) {
    console.log('Open on any device (passphrase required):\n');
    const pad = Math.max(...shareable.map((u) => u.label.length));
    for (const { label, url } of shareable) {
      console.log(`  ${label.padEnd(pad)}   ${url}`);
    }
    console.log('\nUse one of these on this machine too, so the room QR is scannable by others.\n');
  } else {
    console.log(`No network address found — reachable on this machine only:\n\n  http://localhost:${config.port}\n`);
  }
});
