// server.js
const fs = require('fs');
const { loadConfig } = require('./lib/config');
const { createApp } = require('./app');
const { cleanupIdleRooms } = require('./lib/cleanup');

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });

const app = createApp(config);
app.set('trust proxy', 'loopback'); // cloudflared is a single loopback hop; prevents X-Forwarded-For spoofing

const HOUR = 60 * 60 * 1000;
setInterval(() => {
  cleanupIdleRooms(config.dataDir, config.roomIdleDays).catch((e) => console.error('cleanup failed', e));
}, HOUR).unref();

app.listen(config.port, () => {
  console.log(`filedrops listening on http://localhost:${config.port}`);
});
