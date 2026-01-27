function parseRepoUrl(url) {
  if (!url) return null;

  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS format: https://github.com/owner/repo.git (may include auth in URL)
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
  } catch {
    // not a valid URL
  }

  return null;
}

function buildCommitUrl(repoUrl, sha) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}/commit/${sha}`;
}

module.exports = { parseRepoUrl, buildCommitUrl };
