/**
 * GitHub module exports.
 *
 * Provides GitHub API client, worktree management, PR creation, and code review.
 */

// Client
export {
  GitHubClient,
  GitHubError,
  GitHubAuthError,
  GitHubNotFoundError,
  createGitHubClient,
  type PullRequest,
  type ReviewComment,
  type Review,
  type ChangedFile,
} from './client.js';

// Worktree
export {
  WorktreeManager,
  WorktreeError,
  createWorktreeManager,
  type Worktree,
} from './worktree.js';

// PR Manager
export {
  PRManager,
  createPRManager,
  type PRCreationResult,
} from './pr-manager.js';

// Reviewer
export {
  ReviewerAgent,
  createReviewerAgent,
  type ReviewResult,
  type ReviewerOptions,
} from './reviewer.js';
