const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = process.env.CONFIG_FILE || '/data/config.json';

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  }

  // Backward compat: synthesize a single mapping from env vars
  const backupDir = process.env.BACKUP_DIR || '/backup';
  const repoSubdir = process.env.REPO_SUBDIR || '';
  return {
    mappings: [
      {
        id: generateId(),
        name: repoSubdir || 'Default',
        sourceDir: backupDir,
        repoSubdir: repoSubdir,
        enabled: true,
      },
    ],
  };
}

function saveConfig(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}

function getSettings() {
  const cfg = loadConfig();
  return cfg.settings || {};
}

function updateSettings(updates) {
  const cfg = loadConfig();
  cfg.settings = { ...(cfg.settings || {}), ...updates };
  saveConfig(cfg);
  return cfg.settings;
}

function getMappings() {
  return loadConfig().mappings;
}

function addMapping({ name, sourceDir, repoSubdir }) {
  const cfg = loadConfig();
  if (cfg.mappings.some((m) => m.repoSubdir === repoSubdir)) {
    throw new Error(`A mapping with repoSubdir "${repoSubdir}" already exists`);
  }
  const mapping = {
    id: generateId(),
    name,
    sourceDir,
    repoSubdir,
    enabled: true,
    ignorePatterns: [],
  };
  cfg.mappings.push(mapping);
  saveConfig(cfg);
  return mapping;
}

function updateMapping(id, updates) {
  const cfg = loadConfig();
  const idx = cfg.mappings.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(`Mapping ${id} not found`);

  if (
    updates.repoSubdir !== undefined &&
    updates.repoSubdir !== cfg.mappings[idx].repoSubdir &&
    cfg.mappings.some((m) => m.id !== id && m.repoSubdir === updates.repoSubdir)
  ) {
    throw new Error(`A mapping with repoSubdir "${updates.repoSubdir}" already exists`);
  }

  const allowed = ['name', 'sourceDir', 'repoSubdir', 'enabled', 'ignorePatterns', 'readmeSection'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      cfg.mappings[idx][key] = updates[key];
    }
  }
  saveConfig(cfg);
  return cfg.mappings[idx];
}

function deleteMapping(id) {
  const cfg = loadConfig();
  const idx = cfg.mappings.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(`Mapping ${id} not found`);
  cfg.mappings.splice(idx, 1);
  saveConfig(cfg);
}

module.exports = { loadConfig, getSettings, updateSettings, getMappings, addMapping, updateMapping, deleteMapping, CONFIG_FILE };
