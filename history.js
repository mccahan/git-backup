const fs = require('fs');
const path = require('path');

const HISTORY_FILE = process.env.HISTORY_FILE || '/data/history.json';
const MAX_ENTRIES = 500;

function readHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeHistory(entries) {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, HISTORY_FILE);
}

function addHistoryEntry(entry) {
  const entries = readHistory();
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }
  writeHistory(entries);
}

function getHistory({ mappingId, limit } = {}) {
  let entries = readHistory();
  if (mappingId) {
    entries = entries.filter((e) => e.mappingId === mappingId);
  }
  if (limit) {
    entries = entries.slice(0, limit);
  }
  return entries;
}

function getLatestForMapping(mappingId) {
  const entries = readHistory();
  return entries.find((e) => e.mappingId === mappingId) || null;
}

module.exports = { addHistoryEntry, getHistory, getLatestForMapping };
