// lib/cleanup.js
const fs = require('fs/promises');
const path = require('path');
const storage = require('./storage');
const { isValidRoomCode } = require('./rooms');

async function cleanupIdleRooms(dataDir, idleDays, now = Date.now()) {
  const idleMs = idleDays * 24 * 60 * 60 * 1000;
  const removed = [];
  let entries;
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !isValidRoomCode(e.name)) continue;
    const dir = path.join(dataDir, e.name);
    const files = await storage.listFiles(dataDir, e.name);
    if (files.length > 0) continue;
    const stat = await fs.stat(dir);
    if (now - stat.mtimeMs > idleMs) {
      await fs.rm(dir, { recursive: true, force: true });
      removed.push(e.name);
    }
  }
  return removed;
}

module.exports = { cleanupIdleRooms };
