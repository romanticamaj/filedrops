// test/addresses.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { reachableUrls } = require('../lib/addresses');

test('with no external interfaces, only localhost', () => {
  assert.deepStrictEqual(reachableUrls(5178, {}), [
    { label: 'Local', url: 'http://localhost:5178', iface: 'localhost' },
  ]);
});

test('labels + interface name; skips internal and IPv6', () => {
  const ifaces = {
    'Loopback': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    'Wi-Fi': [
      { address: '192.168.1.23', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    'tailscale0': [{ address: '100.100.0.1', family: 'IPv4', internal: false }],
  };
  assert.deepStrictEqual(reachableUrls(5178, ifaces), [
    { label: 'Local', url: 'http://localhost:5178', iface: 'localhost' },
    { label: 'Network', url: 'http://192.168.1.23:5178', iface: 'Wi-Fi' },
    { label: 'Tailscale', url: 'http://100.100.0.1:5178', iface: 'tailscale0' },
  ]);
});

test('virtual/host-only adapters sort after real ones', () => {
  const ifaces = {
    'VirtualBox Host-Only Network': [{ address: '192.168.56.1', family: 'IPv4', internal: false }],
    'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false }],
    'Ethernet': [{ address: '192.168.1.50', family: 'IPv4', internal: false }],
  };
  const order = reachableUrls(80, ifaces).map((u) => u.iface);
  assert.deepStrictEqual(order, ['localhost', 'Ethernet', 'VirtualBox Host-Only Network', 'vEthernet (WSL)']);
});

test('100.64.0.0/10 is Tailscale, other 100.x is not', () => {
  const ifaces = {
    a: [{ address: '100.63.0.1', family: 'IPv4', internal: false }],   // just below the range
    b: [{ address: '100.127.255.9', family: 'IPv4', internal: false }], // top of range
  };
  const labels = reachableUrls(3000, ifaces).map((u) => u.label);
  assert.deepStrictEqual(labels, ['Local', 'Network', 'Tailscale']);
});

test('handles numeric family (some Node builds report family: 4)', () => {
  const ifaces = { eth0: [{ address: '10.0.0.5', family: 4, internal: false }] };
  assert.deepStrictEqual(reachableUrls(3000, ifaces), [
    { label: 'Local', url: 'http://localhost:3000', iface: 'localhost' },
    { label: 'Network', url: 'http://10.0.0.5:3000', iface: 'eth0' },
  ]);
});
