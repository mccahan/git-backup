#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

// Environment variables with defaults
const config = {
  repoUrl: process.env.GIT_REPO_URL,
  branch: process.env.GIT_BRANCH || 'main',
  backupDir: process.env.BACKUP_DIR || '/backup',
  repoDir: '/repo',
  repoSubdir: process.env.REPO_SUBDIR || '', // Subdirectory within the repo to sync to
  userName: process.env.GIT_USER_NAME || 'Git Backup Bot',
  userEmail: process.env.GIT_USER_EMAIL || 'gitbackup@example.com',
};

// Validate required configuration
if (!config.repoUrl) {
  console.error('ERROR: GIT_REPO_URL environment variable is required');
  process.exit(1);
}

console.log(`=== Git Backup Started at ${new Date().toISOString()} ===`);

async function runBackup() {
  try {
    // Initialize git with configuration
    const git = simpleGit();
    await git.addConfig('user.name', config.userName);
    await git.addConfig('user.email', config.userEmail);
    await git.addConfig('init.defaultBranch', config.branch);

    let repoGit;

    // Clone or update the repository
    if (!fs.existsSync(path.join(config.repoDir, '.git'))) {
      console.log(`Cloning repository: ${config.repoUrl}`);
      await simpleGit().clone(config.repoUrl, config.repoDir);
      repoGit = simpleGit(config.repoDir);
      
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
      // Use array form to avoid shell injection
      const result = spawnSync('rsync', [
        '-av',
        '--delete',
        '--exclude=.git',
        '--exclude=.gitignore',
        `${config.backupDir}/`,
        `${targetDir}/`
      ], { stdio: 'inherit' });
      
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
    await repoGit.push('origin', config.branch);

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

// Run the backup
runBackup();
