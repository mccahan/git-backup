#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const cron = require('node-cron');

// Environment variables with defaults
const config = {
  repoUrl: process.env.GIT_REPO_URL,
  branch: process.env.GIT_BRANCH || 'main',
  backupDir: process.env.BACKUP_DIR || '/backup',
  repoDir: '/repo',
  repoSubdir: process.env.REPO_SUBDIR || '', // Subdirectory within the repo to sync to
  userName: process.env.GIT_USER_NAME || 'Git Backup Bot',
  userEmail: process.env.GIT_USER_EMAIL || 'gitbackup@example.com',
  backupIntervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS) || 6,
};

// Validate required configuration
if (!config.repoUrl) {
  console.error('ERROR: GIT_REPO_URL environment variable is required');
  process.exit(1);
}

// Add GITHUB_TOKEN to the repo URL if it's an HTTPS URL
if (config.repoUrl.startsWith('https://') && process.env.GITHUB_TOKEN) {
  const url = new URL(config.repoUrl);
  // GitHub accepts the token directly as the username (with empty password)
  url.username = process.env.GITHUB_TOKEN;
  url.password = ''; // Can be empty when using token as username
  config.repoUrl = url.toString();

  console.log('Using GITHUB_TOKEN for authentication in repository URL');
  // Don't log the full URL as it contains the token
  console.log('Repository URL configured with authentication token');
}

console.log(`=== Git Backup Started at ${new Date().toISOString()} ===`);

async function runBackup() {
  try {
    // Initialize git with configuration
    console.log('Configuring Git user');

    let repoGit;

    // Clone or update the repository
    console.log('Checking repository status');
    if (!fs.existsSync(path.join(config.repoDir, '.git'))) {
      console.log(`Cloning repository: ${config.repoUrl}`);
      await simpleGit().clone(config.repoUrl, config.repoDir);
      repoGit = simpleGit(config.repoDir);
      console.log(`Repository cloned to ${config.repoDir}`);
      // Try to checkout the branch, create if doesn't exist
      try {
        await repoGit.checkout(config.branch);
      } catch (error) {
        await repoGit.checkoutLocalBranch(config.branch);
      }
    } else {
      console.log('Repository exists, fetching latest changes');
      repoGit = simpleGit(config.repoDir);
      await repoGit.fetch('origin');
      // Don't merge - we only push local changes
    }

    console.log("Setting git user.name to:", config.userName);
    await repoGit.addConfig('user.name', config.userName);
    console.log("Setting git user.email to:", config.userEmail);
    await repoGit.addConfig('user.email', config.userEmail);
    console.log("Setting git init.defaultBranch to:", config.branch);
    await repoGit.addConfig('init.defaultBranch', config.branch);

    // Copy files from backup directory to repo (excluding .git)
    const targetDir = config.repoSubdir 
      ? path.join(config.repoDir, config.repoSubdir)
      : config.repoDir;
    
    // Validate paths to prevent command injection
    if (config.backupDir.includes('"') || config.backupDir.includes("'")) {
      throw new Error('Invalid BACKUP_DIR: path contains quotes');
    }
    if (targetDir.includes('"') || targetDir.includes("'")) {
      throw new Error('Invalid target directory: path contains quotes');
    }
    
    // Create subdirectory if it doesn't exist
    if (config.repoSubdir && !fs.existsSync(targetDir)) {
      console.log(`Creating subdirectory: ${config.repoSubdir}`);
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    console.log(`Copying files from ${config.backupDir} to ${targetDir}`);
    try {
      // Build rsync arguments
      const rsyncArgs = [
        '-av',
        '--delete',
        '--exclude=.git',
        '--exclude=.gitignore'
      ];
      
      // Check if .gitignore exists in backup directory and use it for exclusions
      const gitignorePath = path.join(config.backupDir, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        // Validate path to prevent shell injection
        if (gitignorePath.includes('"') || gitignorePath.includes("'") || gitignorePath.includes(';') || gitignorePath.includes('|')) {
          throw new Error('Invalid .gitignore path: contains potentially dangerous characters');
        }
        console.log('Found .gitignore, using it to exclude files');
        rsyncArgs.push(`--exclude-from=${gitignorePath}`);
      }
      
      rsyncArgs.push(`${config.backupDir}/`);
      rsyncArgs.push(`${targetDir}/`);
      
      // Use array form to avoid shell injection
      const result = spawnSync('rsync', rsyncArgs, { stdio: 'inherit' });
      
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`rsync exited with code ${result.status}`);
      }
    } catch (error) {
      console.error('Error during rsync:', error.message);
      throw error;
    }

    // Check if there are changes
    const status = await repoGit.status();
    
    if (status.files.length === 0) {
      console.log('No changes detected, nothing to backup');
      console.log(`=== Git Backup Completed at ${new Date().toISOString()} ===`);
      return;
    }

    console.log('Changes detected:', status.files.length, 'files modified');
    
    // Stage all changes
    await repoGit.add('.');

    // Use GitHub Copilot CLI to commit changes (with fallback)
    await commitWithCopilot(repoGit);

    // Push changes
    console.log('Pushing changes to remote repository');
    await repoGit.push(['--set-upstream', 'origin', config.branch]);

    console.log(`=== Git Backup Completed at ${new Date().toISOString()} ===`);
  } catch (error) {
    console.error('Backup failed:', error.message);
    process.exit(1);
  }
}

async function commitWithCopilot(repoGit) {
  try {
    console.log('Using GitHub Copilot CLI to commit changes...');
    
    // Use the new copilot CLI to perform the commit
    // The --allow-tool flag allows copilot to execute git commands
    const result = spawnSync('copilot', [
      '-p',
      'git commit with message summarizing these changes',
      '--allow-tool',
      'shell(git:*)'
    ], { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.repoDir
    });
    
    if (result.error) {
      throw result.error;
    }
    
    if (result.status !== 0) {
      console.log('Copilot output:', result.stdout);
      console.log('Copilot stderr:', result.stderr);
      throw new Error(`Copilot exited with code ${result.status}`);
    }
    
    console.log('Copilot successfully committed changes');
    console.log('Output:', result.stdout);
  } catch (error) {
    console.log('Copilot unavailable or failed, using fallback commit:', error.message);
    
    // Fallback to manual commit with timestamp
    const fallbackMessage = `Backup: ${new Date().toISOString()}`;
    console.log(`Committing with fallback message: ${fallbackMessage}`);
    await repoGit.commit(fallbackMessage);
  }
}

// Main execution
// Check if we're running in scheduled mode or one-time mode
const isScheduledMode = process.argv.includes('--schedule') || process.env.RUN_SCHEDULER === 'true';

if (isScheduledMode) {
  console.log('=== Git Backup Scheduler Starting ===');
  console.log(`Backup interval: ${config.backupIntervalHours} hours`);
  
  // Run initial backup immediately
  console.log('Running initial backup...');
  runBackup().catch(error => {
    console.error('Initial backup failed:', error.message);
  });
  
  // Schedule periodic backups
  // Convert hours to cron expression: "0 */N * * *" for every N hours
  const cronExpression = `0 */${config.backupIntervalHours} * * *`;
  console.log(`Scheduling backups with cron expression: ${cronExpression}`);
  
  cron.schedule(cronExpression, () => {
    console.log('\n=== Scheduled Backup Starting ===');
    runBackup().catch(error => {
      console.error('Scheduled backup failed:', error.message);
    });
  });
  
  console.log('Scheduler running. Press Ctrl+C to stop.');
  
  // Keep the process running
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    process.exit(0);
  });
} else {
  // One-time backup mode (original behavior)
  runBackup();
}
