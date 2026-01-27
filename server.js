#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const simpleGit = require('simple-git');
const { getGlobalConfig, prepareRepo, runBackupForMapping } = require('./backup');
const { getMappings, addMapping, updateMapping, deleteMapping, getSettings, updateSettings, CONFIG_FILE } = require('./config');
const { addHistoryEntry, getHistory, getLatestForMapping } = require('./history');
const { buildCommitUrl } = require('./github');

const PORT = parseInt(process.env.WEB_UI_PORT) || 3000;
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

const globalConfig = getGlobalConfig();

let backupInProgress = false;

// Sanitize the repo URL for display (strip embedded tokens)
function safeRepoUrl() {
  try {
    const url = new URL(globalConfig.repoUrl);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return globalConfig.repoUrl;
  }
}

async function runFullBackup(mappingId) {
  if (backupInProgress) throw new Error('Backup already in progress');
  backupInProgress = true;

  const results = [];
  try {
    const repoGit = await prepareRepo(globalConfig);
    let mappings = getMappings().filter((m) => m.enabled);

    if (mappingId) {
      mappings = mappings.filter((m) => m.id === mappingId);
      if (mappings.length === 0) throw new Error(`Mapping ${mappingId} not found or disabled`);
    }

    for (const mapping of mappings) {
      try {
        const result = await runBackupForMapping(repoGit, mapping, globalConfig);
        if (result) {
          const commitUrl = buildCommitUrl(process.env.GIT_REPO_URL || '', result.commitSha);
          const entry = {
            timestamp: new Date().toISOString(),
            mappingId: mapping.id,
            mappingName: mapping.name,
            commitSha: result.commitSha,
            commitMessage: result.commitMessage,
            filesChanged: result.filesChanged,
            commitUrl,
          };
          addHistoryEntry(entry);
          results.push(entry);
        } else {
          results.push({ mappingId: mapping.id, mappingName: mapping.name, noChanges: true });
        }
      } catch (err) {
        console.error(`[${mapping.name}] Backup failed:`, err.message);
        results.push({ mappingId: mapping.id, mappingName: mapping.name, error: err.message });
      }
    }

    // Back up config.json into the repo if configured
    const settings = getSettings();
    if (settings.configBackupPath && fs.existsSync(CONFIG_FILE)) {
      try {
        const destPath = path.join(globalConfig.repoDir, settings.configBackupPath);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(CONFIG_FILE, destPath);
        const status = await repoGit.status();
        if (status.files.length > 0) {
          await repoGit.add('.');
          await repoGit.commit('Update git-backup config');
          await repoGit.push(['--set-upstream', 'origin', globalConfig.branch]);
          console.log(`Config backed up to ${settings.configBackupPath}`);
        }
      } catch (err) {
        console.error('Config backup failed:', err.message);
      }
    }
  } finally {
    backupInProgress = false;
  }

  return results;
}

// Express app
const app = express();
app.use(express.json());

// Serve static files under base path
app.use(BASE_PATH || '/', express.static(path.join(__dirname, 'public')));

// API routes
const api = express.Router();

api.get('/status', (req, res) => {
  res.json({
    repoUrl: safeRepoUrl(),
    branch: globalConfig.branch,
    intervalHours: globalConfig.backupIntervalHours,
    backupInProgress,
    basePath: BASE_PATH,
  });
});

api.get('/mappings', (req, res) => {
  const mappings = getMappings().map((m) => {
    const latest = getLatestForMapping(m.id);
    return { ...m, lastBackup: latest };
  });
  res.json(mappings);
});

api.post('/mappings', (req, res) => {
  try {
    const mapping = addMapping(req.body);
    res.status(201).json(mapping);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.put('/mappings/:id', (req, res) => {
  try {
    const mapping = updateMapping(req.params.id, req.body);
    res.json(mapping);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.delete('/mappings/:id', (req, res) => {
  try {
    deleteMapping(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/settings', (req, res) => {
  res.json(getSettings());
});

api.put('/settings', (req, res) => {
  try {
    const settings = updateSettings(req.body);
    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/history', (req, res) => {
  const { mappingId, limit } = req.query;
  const entries = getHistory({ mappingId, limit: limit ? parseInt(limit) : undefined });
  res.json(entries);
});

api.post('/backup', async (req, res) => {
  if (backupInProgress) return res.status(409).json({ error: 'Backup already in progress' });
  const { mappingId } = req.query;
  try {
    const results = await runFullBackup(mappingId);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/backup/running', (req, res) => {
  res.json({ running: backupInProgress });
});

app.use(`${BASE_PATH}/api`, api);

// Start server
app.listen(PORT, () => {
  console.log(`Web UI available at http://localhost:${PORT}${BASE_PATH || '/'}`);
});

// Scheduler
const cronExpression = `0 */${globalConfig.backupIntervalHours} * * *`;
console.log(`Scheduling backups with cron: ${cronExpression}`);

// Initial backup
runFullBackup().catch((err) => console.error('Initial backup failed:', err.message));

cron.schedule(cronExpression, () => {
  console.log('\n=== Scheduled Backup Starting ===');
  runFullBackup().catch((err) => console.error('Scheduled backup failed:', err.message));
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
