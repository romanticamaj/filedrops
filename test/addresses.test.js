// test/addresses.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { reachableUrls } = require('../lib/addresses');

test('with no external interfaces, only localhost', () => {
  assert.deepStrictEqual(reachableUrls(5178, {}), [
    { label: 'Local', url: 'http://localhost:5178' },
  ]);
});

test('labels LAN and Tailscale IPv4, skips internal + IPv6', () => {
  const ifaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [
      { address: '192.168.1.23', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    tailscale0: [{ address: '100.100.0.1', family: 'IPv4', internal: false }],
  };
  assert.deepStrictEqual(reachableUrls(5178, ifaces), [
    { label: 'Local', url: 'http://localhost:5178' },
    { label: 'Network', url: 'http://192.168.1.23:5178' },
    { label: 'Tailscale', url: 'http://100.100.0.1:5178' },
  ]);
});

test('100.64.0.0/10 is Tailscale, other 100.x is not', () => {
  const ifaces = {
    a: [{ address: '100.63.0.1', family: 'IPv4', internal: false }],  // just below the range
    b: [{ address: '100.127.255.9', family: 'IPv4', internal: false }], // top of range
  };
  const labels = reachableUrls(3000, ifaces).map((u) => u.label);
  assert.deepStrictEqual(labels, ['Local', 'Network', 'Tailscale']);
});

test('handles numeric family (some Node builds report family: 4)', () => {
  const ifaces = { eth0: [{ address: '10.0.0.5', family: 4, internal: false }] };
  assert.deepStrictEqual(reachableUrls(3000, ifaces), [
    { label: 'Local', url: 'http://localhost:3000' },
    { label: 'Network', url: 'http://10.0.0.5:3000' },
  ]);
});
