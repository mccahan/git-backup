#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

// Environment variables with defaults
const config = {
  repoUrl: process.env.GIT_REPO_URL,
  branch: process.env.GIT_BRANCH || 'main',
  backupDir: process.env.BACKUP_DIR || '/backup',
  repoDir: '/repo',
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
    console.log(`Copying files from ${config.backupDir} to ${config.repoDir}`);
    try {
      execSync(
        `rsync -av --delete --exclude='.git' --exclude='.gitignore' "${config.backupDir}/" "${config.repoDir}/"`,
        { stdio: 'inherit' }
      );
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

    // Generate commit message using GitHub Copilot
    let commitMessage = await generateCommitMessage(repoGit);

    console.log(`Committing with message: ${commitMessage}`);
    await repoGit.commit(commitMessage);

    // Push changes
    console.log('Pushing changes to remote repository');
    await repoGit.push('origin', config.branch);

    console.log(`=== Git Backup Completed at ${new Date().toISOString()} ===`);
  } catch (error) {
    console.error('Backup failed:', error.message);
    process.exit(1);
  }
}

async function generateCommitMessage(repoGit) {
  try {
    // Get diff stats for context
    const diffStat = await repoGit.diff(['--cached', '--stat']);
    
    console.log('Generating commit message with GitHub Copilot...');
    
    // Use GitHub Copilot to generate commit message
    const copilotCommand = `gh copilot suggest -t shell "git commit with message summarizing these changes: ${diffStat.replace(/"/g, '\\"')}"`;
    
    const output = execSync(copilotCommand, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Extract commit message from Copilot output
    // Copilot typically returns: git commit -m "message"
    const match = output.match(/git commit -m ["'](.+?)["']/);
    
    if (match && match[1]) {
      return match[1];
    }
    
    throw new Error('Could not parse Copilot response');
  } catch (error) {
    console.log('Copilot unavailable or failed, using fallback message:', error.message);
    return `Backup: ${new Date().toISOString()}`;
  }
}

// Run the backup
runBackup();
