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
    const labelPad = Math.max(...shareable.map((u) => u.label.length));
    const urlPad = Math.max(...shareable.map((u) => u.url.length));
    for (const { label, url, iface } of shareable) {
      console.log(`  ${label.padEnd(labelPad)}   ${url.padEnd(urlPad)}   ${iface}`);
    }
    console.log('\nPick the Wi-Fi / Ethernet one (not a VirtualBox/WSL/hotspot adapter).');
    console.log('Open it on this machine too, so the room QR is scannable by others.\n');
  } else {
    console.log(`No network address found — reachable on this machine only:\n\n  http://localhost:${config.port}\n`);
  }
});
