// lib/addresses.js
// The URLs other devices can actually use to reach this server — the startup
// banner should show these, not just localhost.
const os = require('os');

function reachableUrls(port, ifaces = os.networkInterfaces()) {
  const urls = [{ label: 'Local', url: `http://localhost:${port}` }];
  for (const addrs of Object.values(ifaces || {})) {
    for (const a of addrs || []) {
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal) continue;
      // Tailscale hands out addresses in 100.64.0.0/10 (second octet 64–127).
      const oct = a.address.split('.');
      const tailscale = oct[0] === '100' && Number(oct[1]) >= 64 && Number(oct[1]) <= 127;
      urls.push({ label: tailscale ? 'Tailscale' : 'Network', url: `http://${a.address}:${port}` });
    }
  }
  return urls;
}

module.exports = { reachableUrls };
