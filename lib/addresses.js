// lib/addresses.js
// The URLs other devices can actually use to reach this server — the startup
// banner shows these (not just localhost), with the adapter name so you can pick
// the real Wi-Fi/Ethernet and skip virtual/host-only adapters.
const os = require('os');

// Adapters that are almost never your real LAN — VM, WSL, hotspot, container
// bridges. Their host IP is often x.x.x.1 (the host is that virtual subnet's
// gateway), which other devices on your Wi-Fi can't reach.
const VIRTUAL = /virtual|vmware|vmnet|virtualbox|vethernet|hyper-v|wsl|docker|zerotier|loopback|bluetooth/i;

function reachableUrls(port, ifaces = os.networkInterfaces()) {
  const local = { label: 'Local', url: `http://localhost:${port}`, iface: 'localhost' };
  const nets = [];
  for (const [name, addrs] of Object.entries(ifaces || {})) {
    for (const a of addrs || []) {
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal) continue;
      const oct = a.address.split('.');
      const tailscale = oct[0] === '100' && Number(oct[1]) >= 64 && Number(oct[1]) <= 127;
      nets.push({
        label: tailscale ? 'Tailscale' : 'Network',
        url: `http://${a.address}:${port}`,
        iface: name,
        virtual: !tailscale && VIRTUAL.test(name),
      });
    }
  }
  // Real adapters first, virtual/host-only ones last (stable within each group).
  nets.sort((a, b) => Number(a.virtual) - Number(b.virtual));
  return [local, ...nets.map(({ virtual, ...e }) => e)];
}

module.exports = { reachableUrls };
