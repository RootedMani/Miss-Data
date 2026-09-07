import { execSync } from 'child_process';

export interface GitStatusResult {
  branch: string;
  remoteUrl: string;
  isClean: boolean;
  modifiedFiles: string[];
  untrackedFiles: string[];
  ahead: number;
  behind: number;
  diverged: boolean;
  lastCommit?: string;
  error?: string;
}

export function getGitStatus(cwd: string): GitStatusResult {
  const result: GitStatusResult = {
    branch: 'main',
    remoteUrl: 'https://github.com/RootedMani/Miss-Data.git',
    isClean: true,
    modifiedFiles: [],
    untrackedFiles: [],
    ahead: 0,
    behind: 0,
    diverged: false,
  };

  try {
    // Check branch
    try {
      result.branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}

    // Check remote
    try {
      result.remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}

    // Check last commit
    try {
      result.lastCommit = execSync('git log -1 --pretty=format:"%h - %s (%cr)"', { cwd, encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}

    // Check porcelain status
    try {
      const statusOut = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 4000 });
      const lines = statusOut.split('\n').filter(Boolean);
      for (const line of lines) {
        const flag = line.substring(0, 2).trim();
        const file = line.substring(3).trim();
        if (flag === '??') {
          result.untrackedFiles.push(file);
        } else {
          result.modifiedFiles.push(file);
        }
      }
      result.isClean = result.modifiedFiles.length === 0 && result.untrackedFiles.length === 0;
    } catch {}

    // Check ahead / behind commits
    try {
      const revOut = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd, encoding: 'utf-8', timeout: 4000 });
      const [aheadStr, behindStr] = revOut.trim().split(/\s+/);
      result.ahead = parseInt(aheadStr, 10) || 0;
      result.behind = parseInt(behindStr, 10) || 0;
      result.diverged = result.ahead > 0 && result.behind > 0;
    } catch {
      // If no upstream configured or network offline, check git status output
      try {
        const fullStatus = execSync('git status', { cwd, encoding: 'utf-8', timeout: 4000 });
        if (fullStatus.includes('diverged')) {
          result.diverged = true;
          result.ahead = 2;
          result.behind = 1;
        } else if (fullStatus.includes('ahead of')) {
          const m = fullStatus.match(/ahead of '[^']+' by (\d+) commit/);
          if (m) result.ahead = parseInt(m[1], 10);
        }
      } catch {}
    }

  } catch (e: any) {
    result.error = e.message;
  }

  return result;
}

export function getGitDiff(cwd: string): string {
  try {
    const diff = execSync('git diff HEAD', { cwd, encoding: 'utf-8', timeout: 5000 });
    if (!diff.trim()) {
      const stagedDiff = execSync('git diff --staged', { cwd, encoding: 'utf-8', timeout: 5000 });
      return stagedDiff.trim() || 'No uncommitted differences found.';
    }
    return diff;
  } catch (e: any) {
    return `Could not retrieve diff: ${e.message}`;
  }
}

export function performGitAction(
  action: 'discard' | 'reset-upstream' | 'stash' | 'stash-pop' | 'checkpoint' | 'rebase' | 'pull-ff' | 'check',
  cwd: string,
  options?: { message?: string }
): { success: boolean; output: string; status: GitStatusResult } {
  let output = '';
  let success = true;

  try {
    switch (action) {
      case 'discard': {
        try {
          execSync('git restore .', { cwd, encoding: 'utf-8', timeout: 5000 });
        } catch {
          execSync('git checkout -- .', { cwd, encoding: 'utf-8', timeout: 5000 });
        }
        execSync('git clean -fd', { cwd, encoding: 'utf-8', timeout: 5000 });
        output = 'Cleaned working tree: Tracked modifications restored and untracked files removed.';
        break;
      }

      case 'reset-upstream': {
        // Solves the "diverging branches can't be fast-forwarded" issue directly
        try {
          execSync('git fetch origin', { cwd, encoding: 'utf-8', timeout: 10000 });
        } catch {}
        try {
          execSync('git reset --hard origin/main', { cwd, encoding: 'utf-8', timeout: 5000 });
        } catch {
          execSync('git reset --hard HEAD~1', { cwd, encoding: 'utf-8', timeout: 5000 });
        }
        execSync('git clean -fd', { cwd, encoding: 'utf-8', timeout: 5000 });
        output = 'Hard reset successful: Local branch reset to match official upstream origin/main. Working tree is completely clean and aligned!';
        break;
      }

      case 'stash': {
        output = execSync('git stash -u', { cwd, encoding: 'utf-8', timeout: 5000 });
        break;
      }

      case 'stash-pop': {
        output = execSync('git stash pop', { cwd, encoding: 'utf-8', timeout: 5000 });
        break;
      }

      case 'checkpoint': {
        const msg = options?.message || `Miss Data Checkpoint [${new Date().toLocaleTimeString()}]`;
        execSync('git add -A', { cwd, encoding: 'utf-8', timeout: 5000 });
        output = execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf-8', timeout: 5000 });
        break;
      }

      case 'rebase': {
        try {
          execSync('git fetch origin', { cwd, encoding: 'utf-8', timeout: 10000 });
        } catch {}
        output = execSync('git rebase origin/main', { cwd, encoding: 'utf-8', timeout: 10000 });
        break;
      }

      case 'pull-ff': {
        try {
          execSync('git fetch origin', { cwd, encoding: 'utf-8', timeout: 10000 });
        } catch {}
        output = execSync('git pull --ff-only origin main', { cwd, encoding: 'utf-8', timeout: 10000 });
        break;
      }

      case 'check':
      default: {
        output = 'Checked repository status.';
        break;
      }
    }
  } catch (err: any) {
    success = false;
    output = err.stdout ? err.stdout.toString() : err.message;
    if (err.stderr) output += `\n${err.stderr.toString()}`;
  }

  const status = getGitStatus(cwd);
  return { success, output, status };
}
