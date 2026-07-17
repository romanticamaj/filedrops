// lib/storage.js
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { roomDir } = require('./rooms');

const META = '.meta.json';

const roomLocks = new Map(); // room dir -> tail promise
function withRoomLock(key, fn) {
  const prev = roomLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn); // run fn after prev settles, regardless of outcome
  roomLocks.set(key, run.then(() => {}, () => {})); // non-rejecting tail so the chain continues
  return run;
}

async function readMeta(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, META), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

async function writeMeta(dir, meta) {
  await fs.writeFile(path.join(dir, META), JSON.stringify(meta), 'utf8');
}

async function ensureRoom(dataDir, code) {
  const dir = roomDir(dataDir, code);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function newFileId() {
  return crypto.randomBytes(16).toString('hex');
}

async function addFileMeta(dataDir, code, entry, now = Date.now()) {
  const dir = roomDir(dataDir, code);
  return withRoomLock(dir, async () => {
    const meta = await readMeta(dir);
    meta[entry.id] = {
      id: entry.id,
      name: entry.originalName,
      size: entry.size,
      mime: entry.mime || 'application/octet-stream',
      uploadedAt: now,
    };
    await writeMeta(dir, meta);
  });
}

async function listFiles(dataDir, code) {
  const dir = roomDir(dataDir, code);
  const meta = await readMeta(dir);
  return Object.values(meta).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

async function getFile(dataDir, code, id) {
  const dir = roomDir(dataDir, code);
  const meta = await readMeta(dir);
  const m = meta[id];
  if (!m) return null;
  return { path: path.join(dir, id), name: m.name, mime: m.mime };
}

async function deleteFile(dataDir, code, id) {
  const dir = roomDir(dataDir, code);
  return withRoomLock(dir, async () => {
    const meta = await readMeta(dir);
    if (!meta[id]) return false;
    delete meta[id];
    await writeMeta(dir, meta);
    await fs.rm(path.join(dir, id), { force: true });
    return true;
  });
}

async function clearRoom(dataDir, code) {
  const dir = roomDir(dataDir, code);
  await fs.rm(dir, { recursive: true, force: true });
}

module.exports = {
  ensureRoom, newFileId, addFileMeta, listFiles, getFile, deleteFile, clearRoom,
};
