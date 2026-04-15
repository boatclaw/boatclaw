/**
 * Pull Request manager.
 *
 * Coordinates worktree creation, commits, pushing, and PR creation.
 */

import { GitHubClient, PullRequest } from './client.js';
import { WorktreeManager, Worktree } from './worktree.js';
import { Card } from '../platforms/types.js';

/**
 * Result of PR creation process
 */
export interface PRCreationResult {
  success: boolean;
  pr?: PullRequest;
  worktree?: Worktree;
  error?: string;
  hasChanges: boolean;
}

/**
 * Manages the complete PR creation workflow
 */
export class PRManager {
  private github: GitHubClient;
  private worktrees: WorktreeManager;
  private baseBranch: string;
  private branchPrefix: string;

  constructor(options: {
    githubClient: GitHubClient;
    worktreeManager: WorktreeManager;
    baseBranch?: string;
    branchPrefix?: string;
  }) {
    this.github = options.githubClient;
    this.worktrees = options.worktreeManager;
    this.baseBranch = options.baseBranch || 'main';
    this.branchPrefix = options.branchPrefix || 'feature/';
  }

  /**
   * Generate a branch name from a card
   */
  generateBranchName(card: Card): string {
    // Clean title for branch name
    let titleSlug = card.title.toLowerCase();
    titleSlug = titleSlug.replace(/[^a-z0-9\s]/g, '');
    titleSlug = titleSlug
      .split(/\s+/)
      .slice(0, 6)
      .join('-');

    // Use card ID or first part of it
    const cardId = card.id.length > 8 ? card.id.slice(0, 8) : card.id;

    return `${this.branchPrefix}${cardId}-${titleSlug}`;
  }

  /**
   * Generate PR description from card details
   */
  generatePRDescription(card: Card, summary?: string): string {
    const lines: string[] = ['## Summary', ''];

    if (summary) {
      lines.push(summary);
    } else if (card.description) {
      lines.push(card.description.slice(0, 500));
    } else {
      lines.push(`Implements: ${card.title}`);
    }

    lines.push('', '## Task Details', '');
    lines.push(`- **Card:** [${card.title}](${card.url})`);

    if (card.labels.length > 0) {
      const labels = card.labels.map((l) => `\`${l.name}\``).join(', ');
      lines.push(`- **Labels:** ${labels}`);
    }

    lines.push(
      '',
      '---',
      '',
      '*This PR was automatically created by [Boatclaw](https://boatclaw.dev)*'
    );

    return lines.join('\n');
  }

  /**
   * Prepare a worktree for a task
   */
  async prepareForTask(card: Card, taskId?: string): Promise<Worktree> {
    const id = taskId || card.id;
    const branchName = this.generateBranchName(card);

    // Create worktree with new branch
    const worktree = await this.worktrees.createWorktree({
      taskId: id,
      branchName,
      baseBranch: this.baseBranch,
    });

    return worktree;
  }

  /**
   * Get the worktree path for a task
   */
  getWorktreePath(taskId: string): string {
    return this.worktrees.getWorktreePath(taskId);
  }

  /**
   * Check if a worktree exists for a task
   */
  async hasWorktree(taskId: string): Promise<boolean> {
    const worktree = await this.worktrees.getWorktree(taskId);
    return worktree !== null;
  }

  /**
   * Create a PR for a completed task
   */
  async createPRForTask(options: {
    card: Card;
    taskId?: string;
    commitMessage?: string;
    summary?: string;
    draft?: boolean;
  }): Promise<PRCreationResult> {
    const taskId = options.taskId || options.card.id;

    let worktree: Worktree | null = null;

    try {
      // Check for changes
      const hasChanges = await this.worktrees.hasChanges(taskId);

      if (!hasChanges) {
        return {
          success: true,
          hasChanges: false,
        };
      }

      // Get worktree
      worktree = await this.worktrees.getWorktree(taskId);
      if (!worktree) {
        return {
          success: false,
          error: `Worktree not found: ${taskId}`,
          hasChanges: false,
        };
      }

      // Generate commit message
      const commitMessage =
        options.commitMessage ||
        `${options.card.title}\n\nTask: ${options.card.url}`;

      // Commit changes
      const commit = await this.worktrees.commitChanges({
        taskId,
        message: commitMessage,
      });

      if (!commit) {
        return {
          success: true,
          hasChanges: false,
          worktree,
        };
      }

      // Push branch
      await this.worktrees.pushBranch({ taskId });

      // Create PR
      const prTitle = options.card.title;
      const prBody = this.generatePRDescription(options.card, options.summary);

      const pr = await this.github.createPullRequest({
        title: prTitle,
        head: worktree.branch,
        base: this.baseBranch,
        body: prBody,
        draft: options.draft,
      });

      return {
        success: true,
        pr,
        worktree,
        hasChanges: true,
      };
    } catch (error) {
      // If PR already exists for this branch (422), find and return it
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 422) {
        try {
          const existingPR = await this.findPRForBranch(worktree!.branch);
          if (existingPR) {
            return {
              success: true,
              pr: existingPR,
              worktree: worktree!,
              hasChanges: true,
            };
          }
        } catch {
          // Fall through to error return
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: errorMessage,
        hasChanges: true, // Changes exist, PR creation just failed
      };
    }
  }

  /**
   * Clean up after a task is complete
   */
  async cleanupTask(taskId: string): Promise<void> {
    await this.worktrees.removeWorktree(taskId);
  }

  /**
   * Get PR URL for a branch
   */
  async findPRForBranch(branchName: string): Promise<PullRequest | null> {
    const prs = await this.github.listPullRequests({
      state: 'open',
      head: branchName,
    });

    return prs.length > 0 ? prs[0] : null;
  }

  /**
   * Update PR description with task summary
   */
  async updatePRDescription(options: {
    prNumber: number;
    summary: string;
    card: Card;
  }): Promise<PullRequest> {
    const body = this.generatePRDescription(options.card, options.summary);

    return this.github.updatePullRequest({
      prNumber: options.prNumber,
      body,
    });
  }
}

/**
 * Create a PR manager.
 */
export function createPRManager(options: {
  githubClient: GitHubClient;
  worktreeManager: WorktreeManager;
  baseBranch?: string;
  branchPrefix?: string;
}): PRManager {
  return new PRManager(options);
}
