#!/usr/bin/env node

const { spawnSync } = require('child_process');
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
const CONFIG_BACKUP_PATH = process.env.CONFIG_BACKUP_PATH || '';

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

function restoreConfigFromRepo(repoDir) {
  // If an explicit path is configured, try that first
  const explicit = CONFIG_BACKUP_PATH || '';
  if (explicit) {
    const fullPath = path.join(repoDir, explicit);
    if (fs.existsSync(fullPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        if (Array.isArray(data.mappings)) {
          const dir = path.dirname(CONFIG_FILE);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(fullPath, CONFIG_FILE);
          console.log(`Restored config from repo: ${explicit}`);
          return true;
        }
      } catch { /* not valid config, fall through */ }
    }
  }

  // Auto-discover: scan repo root for *.json files containing a mappings array
  try {
    const entries = fs.readdirSync(repoDir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const fullPath = path.join(repoDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        if (Array.isArray(data.mappings) && data.mappings.length > 0 && data.mappings[0].sourceDir) {
          const dir = path.dirname(CONFIG_FILE);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(fullPath, CONFIG_FILE);
          console.log(`Auto-discovered and restored config from repo: ${entry}`);
          return true;
        }
      } catch { /* skip unparseable files */ }
    }
  } catch (err) {
    console.error('Config auto-discovery failed:', err.message);
  }

  return false;
}

async function runFullBackup(mappingId) {
  if (backupInProgress) throw new Error('Backup already in progress');
  backupInProgress = true;

  const results = [];
  try {
    // Attach global ignore patterns so backup.js can use them
    const settings = getSettings();
    globalConfig.globalIgnorePatterns = settings.globalIgnorePatterns || [];

    const repoGit = await prepareRepo(globalConfig);

    // Restore config from repo on first run if local config doesn't exist
    if (!fs.existsSync(CONFIG_FILE)) {
      const restored = restoreConfigFromRepo(globalConfig.repoDir);
      if (restored) {
        // Re-read settings since config was just restored
        const restoredSettings = getSettings();
        globalConfig.globalIgnorePatterns = restoredSettings.globalIgnorePatterns || [];
      }
    }

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

    // Update root README.md with sections for opted-in mappings
    const readmeMappings = mappings.filter((m) => m.readmeSection);
    if (readmeMappings.length > 0) {
      try {
        const readmePath = path.join(globalConfig.repoDir, 'README.md');
        let readmeContent = '';
        if (fs.existsSync(readmePath)) {
          readmeContent = fs.readFileSync(readmePath, 'utf-8');
        }

        const startMarker = '<!-- git-backup-start -->';
        const endMarker = '<!-- git-backup-end -->';

        const sections = [];
        for (const m of readmeMappings) {
          const subdir = m.repoSubdir || '.';
          const targetDir = m.repoSubdir ? path.join(globalConfig.repoDir, m.repoSubdir) : globalConfig.repoDir;
          const latest = results.find((r) => r.mappingId === m.id && !r.noChanges && !r.error);
          const latestNoChange = results.find((r) => r.mappingId === m.id && r.noChanges);
          let statusLine = '';
          if (latest) {
            statusLine = `Last backup: ${latest.commitSha.substring(0, 7)} — ${latest.filesChanged} files changed`;
            if (latest.commitUrl) statusLine = `Last backup: [${latest.commitSha.substring(0, 7)}](${latest.commitUrl}) — ${latest.filesChanged} files changed`;
          } else if (latestNoChange) {
            statusLine = 'Last backup: no changes detected';
          }

          // Use Copilot to generate a description of the mapping contents
          let description = '';
          try {
            const prompt = `Look at the files in the directory "${targetDir}" and write a concise Markdown description (can include sentences, lists of features or notable tools like Docker images/projects, etc) of what this project or directory contains. Describe the purpose of the application or configuration, key technologies used, and notable files. Do not include any thinking or general information about the backup process. Output ONLY the Markdown text, no code fences, no tool runs.`;
            console.log(`[${m.name}] Generating README description via Copilot...`);
            const result = spawnSync(
              'copilot',
              ['-p', prompt, '--allow-tool', 'shell(ls:*,cat:*,head:*,file:*)'],
              { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: targetDir, timeout: 60000 }
            );
            if (result.error) throw result.error;
            if (result.status !== 0) throw new Error(`Copilot exited with code ${result.status}`);
            const output = (result.stdout || '').trim();
            if (output) {
              description = output;
              console.log(`[${m.name}] Copilot description generated`);
            }
          } catch (err) {
            console.log(`[${m.name}] Copilot description unavailable: ${err.message}`);
          }

          const lines = [`### ${m.name}`, '', `- **Source:** \`${m.sourceDir}\``, `- **Path:** \`${subdir}\``];
          if (statusLine) lines.push(`- ${statusLine}`);
          if (description) lines.push('', description);
          sections.push(lines.join('\n'));
        }

        const managedBlock = `${startMarker}\n## Backup Contents\n\n${sections.join('\n\n')}\n${endMarker}`;

        const startIdx = readmeContent.indexOf(startMarker);
        const endIdx = readmeContent.indexOf(endMarker);
        if (startIdx !== -1 && endIdx !== -1) {
          readmeContent = readmeContent.substring(0, startIdx) + managedBlock + readmeContent.substring(endIdx + endMarker.length);
        } else {
          readmeContent = readmeContent ? readmeContent.trimEnd() + '\n\n' + managedBlock + '\n' : managedBlock + '\n';
        }

        fs.writeFileSync(readmePath, readmeContent);
        console.log(`Updated README.md with ${readmeMappings.length} mapping sections`);
      } catch (err) {
        console.error('README update failed:', err.message);
      }
    }

    // Back up config.json into the repo if configured
    if (settings.configBackupPath && fs.existsSync(CONFIG_FILE)) {
      try {
        const destPath = path.join(globalConfig.repoDir, settings.configBackupPath);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(CONFIG_FILE, destPath);
        console.log(`Config copied to ${settings.configBackupPath}`);
      } catch (err) {
        console.error('Config backup failed:', err.message);
      }
    }

    // Commit any housekeeping changes (README, config backup)
    try {
      const status = await repoGit.status();
      if (status.files.length > 0) {
        await repoGit.add('.');
        await repoGit.commit('Update git-backup metadata');
        await repoGit.push(['--set-upstream', 'origin', globalConfig.branch]);
        console.log('Committed git-backup metadata updates');
      }
    } catch (err) {
      console.error('Metadata commit failed:', err.message);
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
