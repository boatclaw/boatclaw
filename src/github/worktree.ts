/**
 * Git worktree manager for parallel branch operations.
 *
 * Git worktrees allow multiple branches to be checked out simultaneously
 * in different directories, enabling parallel PR creation.
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';

/**
 * Represents a git worktree
 */
export interface Worktree {
  path: string;
  branch: string;
  commit: string;
  isMain: boolean;
}

/**
 * Worktree operation error
 */
export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}

/**
 * Manages git worktrees for parallel branch operations
 */
export class WorktreeManager {
  private mainRepoPath: string;
  private worktreeBase: string;
  private projectName: string;

  constructor(options: { mainRepoPath: string; worktreeBase?: string }) {
    this.mainRepoPath = resolve(options.mainRepoPath);
    this.worktreeBase =
      options.worktreeBase || resolve(homedir(), '.boatclaw', 'worktrees');
    this.projectName = this.mainRepoPath.split('/').pop() || 'project';
  }

  private async runGit(
    args: string[],
    cwd?: string
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn('git', args, {
        cwd: cwd || this.mainRepoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          code: code ?? 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      proc.on('error', () => {
        resolve({
          code: 1,
          stdout: '',
          stderr: 'Git command failed to execute',
        });
      });
    });
  }

  /**
   * Get the worktree path for a task
   */
  getWorktreePath(taskId: string): string {
    return resolve(this.worktreeBase, this.projectName, taskId);
  }

  /**
   * Create a new worktree for a task
   */
  async createWorktree(options: {
    taskId: string;
    branchName: string;
    baseBranch?: string;
  }): Promise<Worktree> {
    const baseBranch = options.baseBranch || 'main';

    // Worktree path
    const worktreePath = this.getWorktreePath(options.taskId);

    // Create parent directory
    const parentDir = resolve(this.worktreeBase, this.projectName);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // If worktree already exists, remove it first
    if (existsSync(worktreePath)) {
      await this.removeWorktree(options.taskId);
    }

    // Fetch latest from remote (non-fatal — fall back to local branch if fetch fails)
    const fetchResult = await this.runGit(['fetch', 'origin', baseBranch]);
    const useLocal = fetchResult.code !== 0;
    const baseRef = useLocal ? baseBranch : `origin/${baseBranch}`;

    // Create new branch from base
    let result = await this.runGit([
      'worktree',
      'add',
      '-b',
      options.branchName,
      worktreePath,
      baseRef,
    ]);

    // Auto-fix common failures and retry
    if (result.code !== 0) {
      const stderr = result.stderr.toLowerCase();

      if (stderr.includes('already exists')) {
        // Auto-fix: delete old branch and retry
        await this.runGit(['branch', '-D', options.branchName]);
        // Also clean up any leftover worktree for this branch
        await this.runGit(['worktree', 'prune']);
        result = await this.runGit([
          'worktree', 'add', '-b', options.branchName, worktreePath, baseRef,
        ]);
      }

      if (result.code !== 0) {
        const retryStderr = result.stderr.toLowerCase();
        if (retryStderr.includes('not a git repository')) {
          throw new WorktreeError(
            `"${this.mainRepoPath}" is not a git repository. Make sure the project path is correct.`
          );
        } else {
          throw new WorktreeError(`Failed to create worktree: ${result.stderr}`);
        }
      }
    }

    // Get commit hash
    const commitResult = await this.runGit(['rev-parse', 'HEAD'], worktreePath);

    return {
      path: worktreePath,
      branch: options.branchName,
      commit: commitResult.stdout,
      isMain: false,
    };
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(taskId: string): Promise<boolean> {
    const worktreePath = this.getWorktreePath(taskId);

    if (!existsSync(worktreePath)) {
      return true;
    }

    // Get branch name before removing worktree
    const branchResult = await this.runGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      worktreePath
    );
    const worktree = branchResult.code === 0 ? { branch: branchResult.stdout } : null;

    // Remove from git
    await this.runGit(['worktree', 'remove', worktreePath, '--force']);

    // Clean up directory if still exists
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }

    // Try to delete the remote branch (best effort)
    if (worktree) {
      try {
        await this.runGit(['push', 'origin', '--delete', worktree.branch], this.mainRepoPath);
      } catch {
        // Ignore — branch may not have been pushed, or remote may not exist
      }
    }

    return true;
  }

  /**
   * Get worktree by task ID
   */
  async getWorktree(taskId: string): Promise<Worktree | null> {
    const worktreePath = this.getWorktreePath(taskId);

    if (!existsSync(worktreePath)) {
      return null;
    }

    // Get branch name
    const branchResult = await this.runGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      worktreePath
    );

    if (branchResult.code !== 0) {
      return null;
    }

    // Get commit
    const commitResult = await this.runGit(['rev-parse', 'HEAD'], worktreePath);

    return {
      path: worktreePath,
      branch: branchResult.stdout,
      commit: commitResult.stdout,
      isMain: false,
    };
  }

  /**
   * List all worktrees for this project
   */
  async listWorktrees(): Promise<Worktree[]> {
    const projectDir = resolve(this.worktreeBase, this.projectName);

    if (!existsSync(projectDir)) {
      return [];
    }

    const worktrees: Worktree[] = [];
    const entries = readdirSync(projectDir);

    for (const entry of entries) {
      const worktree = await this.getWorktree(entry);
      if (worktree) {
        worktrees.push(worktree);
      }
    }

    return worktrees;
  }

  /**
   * Commit changes in a worktree
   */
  async commitChanges(options: {
    taskId: string;
    message: string;
    addAll?: boolean;
    baseBranch?: string;
  }): Promise<string | null> {
    const worktree = await this.getWorktree(options.taskId);
    if (!worktree) {
      throw new WorktreeError(`Worktree not found: ${options.taskId}`);
    }

    // Check for uncommitted changes
    const statusResult = await this.runGit(
      ['status', '--porcelain'],
      worktree.path
    );

    if (statusResult.stdout) {
      // Stage and commit uncommitted changes
      if (options.addAll !== false) {
        await this.runGit(['add', '-A'], worktree.path);
      }

      const commitResult = await this.runGit(
        ['commit', '-m', options.message],
        worktree.path
      );

      if (commitResult.code !== 0) {
        throw new WorktreeError(`Failed to commit: ${commitResult.stderr}`);
      }
    }

    // Check if there are ANY commits on this branch vs base
    // (AI agents like Claude commit changes themselves during execution)
    const base = options.baseBranch || 'main';
    const logResult = await this.runGit(
      ['log', `origin/${base}..HEAD`, '--oneline'],
      worktree.path
    );

    if (!logResult.stdout) {
      return null; // No changes at all (uncommitted or committed)
    }

    // Get commit hash
    const hashResult = await this.runGit(['rev-parse', 'HEAD'], worktree.path);

    return hashResult.stdout;
  }

  /**
   * Push the worktree branch to remote
   */
  async pushBranch(options: { taskId: string; force?: boolean }): Promise<boolean> {
    const worktree = await this.getWorktree(options.taskId);
    if (!worktree) {
      throw new WorktreeError(`Worktree not found: ${options.taskId}`);
    }

    const args = ['push', '-u', 'origin', worktree.branch];
    if (options.force) {
      args.push('--force');
    }

    const result = await this.runGit(args, worktree.path);

    if (result.code !== 0) {
      throw new WorktreeError(`Failed to push: ${result.stderr}`);
    }

    return true;
  }

  /**
   * Check if worktree has changes (uncommitted OR committed on the branch).
   * AI agents like Claude commit changes themselves, so we must also check
   * for committed changes relative to the base branch.
   */
  async hasChanges(taskId: string, baseBranch?: string): Promise<boolean> {
    const worktree = await this.getWorktree(taskId);
    if (!worktree) {
      return false;
    }

    // Check for uncommitted changes
    const statusResult = await this.runGit(['status', '--porcelain'], worktree.path);
    if (statusResult.stdout) {
      return true;
    }

    // Check for committed changes on the branch vs base branch
    // (AI agents like Claude commit changes themselves during execution)
    const base = baseBranch || 'main';
    const diffResult = await this.runGit(
      ['log', `origin/${base}..HEAD`, '--oneline'],
      worktree.path
    );

    return !!diffResult.stdout;
  }

  /**
   * Get diff between worktree and base branch
   */
  async getDiff(options: { taskId: string; baseBranch?: string }): Promise<string> {
    const worktree = await this.getWorktree(options.taskId);
    if (!worktree) {
      throw new WorktreeError(`Worktree not found: ${options.taskId}`);
    }

    const baseBranch = options.baseBranch || 'main';

    // Fetch base branch
    await this.runGit(['fetch', 'origin', baseBranch], worktree.path);

    // Get diff
    const result = await this.runGit(
      ['diff', `origin/${baseBranch}...HEAD`],
      worktree.path
    );

    return result.stdout;
  }

  /**
   * Get list of changed files in worktree
   */
  async getChangedFiles(taskId: string): Promise<string[]> {
    const worktree = await this.getWorktree(taskId);
    if (!worktree) {
      return [];
    }

    const result = await this.runGit(
      ['status', '--porcelain'],
      worktree.path
    );

    if (!result.stdout) {
      return [];
    }

    return result.stdout
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((file) => file.length > 0);
  }

  /**
   * Clean up old worktrees
   */
  async cleanupOldWorktrees(maxAgeHours: number = 24): Promise<number> {
    const projectDir = resolve(this.worktreeBase, this.projectName);

    if (!existsSync(projectDir)) {
      return 0;
    }

    let removed = 0;
    const cutoff = Date.now() - maxAgeHours * 3600 * 1000;

    const entries = readdirSync(projectDir);

    for (const entry of entries) {
      const entryPath = resolve(projectDir, entry);
      try {
        const stats = statSync(entryPath);
        if (stats.isDirectory() && stats.mtimeMs < cutoff) {
          await this.removeWorktree(entry);
          removed++;
        }
      } catch {
        // Ignore errors
      }
    }

    return removed;
  }
}

/**
 * Create a worktree manager.
 */
export function createWorktreeManager(options: {
  mainRepoPath: string;
  worktreeBase?: string;
}): WorktreeManager {
  return new WorktreeManager(options);
}
