#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

const REPO_DIR = '/repo';

/**
 * Build a global config object from environment variables.
 */
function getGlobalConfig() {
  const cfg = {
    repoUrl: process.env.GIT_REPO_URL,
    branch: process.env.GIT_BRANCH || 'main',
    repoDir: REPO_DIR,
    userName: process.env.GIT_USER_NAME || 'Git Backup Bot',
    userEmail: process.env.GIT_USER_EMAIL || 'gitbackup@example.com',
    backupIntervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS) || 6,
  };

  if (!cfg.repoUrl) {
    throw new Error('GIT_REPO_URL environment variable is required');
  }

  // Embed GITHUB_TOKEN into the clone URL
  if (cfg.repoUrl.startsWith('https://') && process.env.GITHUB_TOKEN) {
    const url = new URL(cfg.repoUrl);
    url.username = process.env.GITHUB_TOKEN;
    url.password = '';
    cfg.repoUrl = url.toString();
    console.log('Repository URL configured with authentication token');
  }

  return cfg;
}

/**
 * Remove /repo and do a fresh clone. Returns a simple-git instance.
 */
async function prepareRepo(globalConfig) {
  const { repoUrl, branch, repoDir, userName, userEmail } = globalConfig;

  if (fs.existsSync(repoDir)) {
    if (repoDir !== REPO_DIR) {
      throw new Error(`Unexpected repoDir value: ${repoDir}. Expected: ${REPO_DIR}`);
    }
    console.log('Removing existing repository directory for fresh clone');
    fs.rmSync(repoDir, { recursive: true, force: true });
  }

  console.log('Cloning repository...');
  await simpleGit().clone(repoUrl, repoDir);
  const repoGit = simpleGit(repoDir);

  try {
    await repoGit.checkout(branch);
  } catch {
    await repoGit.checkoutLocalBranch(branch);
  }

  await repoGit.addConfig('user.name', userName);
  await repoGit.addConfig('user.email', userEmail);
  await repoGit.addConfig('init.defaultBranch', branch);

  return repoGit;
}

/**
 * Rsync sourceDir into /repo/<repoSubdir>, commit, push.
 * Returns { commitSha, commitMessage, filesChanged } or null if no changes.
 */
async function runBackupForMapping(repoGit, mapping, globalConfig) {
  const { repoDir, branch } = globalConfig;
  const { sourceDir, repoSubdir, name } = mapping;

  const targetDir = repoSubdir ? path.join(repoDir, repoSubdir) : repoDir;

  // Validate paths
  for (const p of [sourceDir, targetDir]) {
    if (/["';|]/.test(p)) {
      throw new Error(`Invalid path: ${p}`);
    }
  }

  if (repoSubdir && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log(`[${name}] Syncing ${sourceDir} → ${targetDir}`);

  const rsyncArgs = [
    '-av',
    '--delete',
    '--exclude=.git',
    '--exclude=.gitignore',
  ];

  // Collect all ignore patterns (global + per-mapping)
  const globalPatterns = (globalConfig.globalIgnorePatterns || []).filter(Boolean);
  const mappingPatterns = (mapping.ignorePatterns || []).filter(Boolean);
  const allPatterns = [...globalPatterns, ...mappingPatterns];

  for (const pattern of allPatterns) {
    rsyncArgs.push(`--exclude=${pattern}`);
  }

  // Source dir .gitignore (from the backed-up directory itself)
  const gitignorePath = path.join(sourceDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    if (/["';|]/.test(gitignorePath)) {
      throw new Error('Invalid .gitignore path');
    }
    rsyncArgs.push(`--exclude-from=${gitignorePath}`);
  }

  rsyncArgs.push(`${sourceDir}/`, `${targetDir}/`);

  const rsyncResult = spawnSync('rsync', rsyncArgs, { stdio: 'inherit' });
  if (rsyncResult.error) throw rsyncResult.error;
  if (rsyncResult.status !== 0) throw new Error(`rsync exited with code ${rsyncResult.status}`);

  // Write managed .gitignore into the repo target directory
  if (allPatterns.length > 0) {
    const gitignoreDest = path.join(targetDir, '.gitignore');
    const content = '# Managed by git-backup\n' + allPatterns.join('\n') + '\n';
    fs.writeFileSync(gitignoreDest, content);
    console.log(`[${name}] Wrote .gitignore (${allPatterns.length} patterns)`);
  }

  const status = await repoGit.status();
  if (status.files.length === 0) {
    console.log(`[${name}] No changes detected`);
    return null;
  }

  const filesChanged = status.files.length;
  console.log(`[${name}] ${filesChanged} files changed`);

  await repoGit.add('.');

  // Commit (Copilot or fallback)
  const commitMessage = await commitWithCopilot(repoGit, name);

  // Push
  await repoGit.push(['--set-upstream', 'origin', branch]);

  // Read SHA
  const log = await repoGit.log({ n: 1 });
  const commitSha = log.latest.hash;

  return { commitSha, commitMessage, filesChanged };
}

async function commitWithCopilot(repoGit, mappingName) {
  try {
    console.log(`[${mappingName}] Attempting Copilot commit...`);
    const result = spawnSync(
      'copilot',
      ['-p', 'git commit with message summarizing these changes', '--allow-tool', 'shell(git:*)'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: REPO_DIR }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Copilot exited with code ${result.status}`);

    console.log(`[${mappingName}] Copilot committed successfully`);
    // Read the commit message Copilot used
    const log = await repoGit.log({ n: 1 });
    return log.latest.message;
  } catch (error) {
    const fallbackMessage = `Backup ${mappingName}: ${new Date().toISOString()}`;
    console.log(`[${mappingName}] Copilot unavailable, using fallback: ${error.message}`);
    await repoGit.commit(fallbackMessage);
    return fallbackMessage;
  }
}

module.exports = { getGlobalConfig, prepareRepo, runBackupForMapping };

// Standalone execution (backward compat)
if (require.main === module) {
  const cron = require('node-cron');

  const globalConfig = getGlobalConfig();
  const backupDir = process.env.BACKUP_DIR || '/backup';
  const repoSubdir = process.env.REPO_SUBDIR || '';

  const mapping = {
    id: 'standalone',
    name: repoSubdir || 'Default',
    sourceDir: backupDir,
    repoSubdir,
    enabled: true,
  };

  async function runBackup() {
    console.log(`=== Git Backup Started at ${new Date().toISOString()} ===`);
    const repoGit = await prepareRepo(globalConfig);
    const result = await runBackupForMapping(repoGit, mapping, globalConfig);
    if (result) {
      console.log(`Committed ${result.filesChanged} files: ${result.commitMessage}`);
    }
    console.log(`=== Git Backup Completed at ${new Date().toISOString()} ===`);
  }

  const isScheduledMode = process.argv.includes('--schedule') || process.env.RUN_SCHEDULER === 'true';

  if (isScheduledMode) {
    console.log(`=== Git Backup Scheduler Starting (every ${globalConfig.backupIntervalHours}h) ===`);

    runBackup().catch((err) => console.error('Initial backup failed:', err.message));

    const cronExpression = `0 */${globalConfig.backupIntervalHours} * * *`;
    cron.schedule(cronExpression, () => {
      runBackup().catch((err) => console.error('Scheduled backup failed:', err.message));
    });

    process.on('SIGTERM', () => process.exit(0));
    process.on('SIGINT', () => process.exit(0));
  } else {
    runBackup().catch((err) => {
      console.error('Backup failed:', err.message);
      process.exit(1);
    });
  }
}
