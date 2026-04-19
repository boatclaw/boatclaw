/**
 * GitHub API client using Octokit.
 *
 * Handles authentication, PR operations, and review submissions.
 */

import { Octokit } from '@octokit/rest';

/**
 * Represents a GitHub Pull Request
 */
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  url: string;
  htmlUrl: string;
  headBranch: string;
  baseBranch: string;
  createdAt: Date;
  updatedAt: Date;
  merged: boolean;
  mergeable: boolean | null;
  diffUrl: string;
}

/**
 * A line-specific review comment
 */
export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  side: 'LEFT' | 'RIGHT';
  suggestion?: string;
}

/**
 * A PR review with comments
 */
export interface Review {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments: ReviewComment[];
}

/**
 * Changed file info
 */
export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

/**
 * GitHub API error types
 */
export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubAuthError extends GitHubError {
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

export class GitHubNotFoundError extends GitHubError {
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'GitHubNotFoundError';
  }
}

/**
 * GitHub API client
 */
export class GitHubClient {
  private octokit: Octokit;
  private defaultOwner?: string;
  private defaultRepo?: string;

  constructor(options: {
    token: string;
    defaultRepo?: string; // "owner/repo" format
  }) {
    this.octokit = new Octokit({
      auth: options.token,
      userAgent: 'boatclaw/1.0.0',
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    if (options.defaultRepo) {
      const [owner, repo] = options.defaultRepo.split('/');
      this.defaultOwner = owner;
      this.defaultRepo = repo;
    }
  }

  private parseRepo(repo?: string): { owner: string; repo: string } {
    if (repo) {
      const [owner, repoName] = repo.split('/');
      return { owner, repo: repoName };
    }

    if (this.defaultOwner && this.defaultRepo) {
      return { owner: this.defaultOwner, repo: this.defaultRepo };
    }

    throw new GitHubError('No repository specified');
  }

  /**
   * Verify the token is valid
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.octokit.rest.users.getAuthenticated();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get authenticated user info
   */
  async getUser(): Promise<{ login: string; name: string | null }> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return { login: data.login, name: data.name };
  }

  /**
   * Get the default branch for a repository
   */
  async getDefaultBranch(repo?: string): Promise<string> {
    const { owner, repo: repoName } = this.parseRepo(repo);

    const { data } = await this.octokit.rest.repos.get({
      owner,
      repo: repoName,
    });

    return data.default_branch;
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branch: string, repo?: string): Promise<boolean> {
    const { owner, repo: repoName } = this.parseRepo(repo);

    try {
      await this.octokit.rest.repos.getBranch({
        owner,
        repo: repoName,
        branch,
      });
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Pull Request Operations ====================

  /**
   * Create a new pull request
   */
  async createPullRequest(options: {
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
    repo?: string;
  }): Promise<PullRequest> {
    const { owner, repo } = this.parseRepo(options.repo);

    const { data } = await this.octokit.rest.pulls.create({
      owner,
      repo,
      title: options.title,
      head: options.head,
      base: options.base,
      body: options.body || '',
      draft: options.draft || false,
    });

    return this.parsePullRequest(data);
  }

  /**
   * Get a pull request by number
   */
  async getPullRequest(prNumber: number, repo?: string): Promise<PullRequest> {
    const { owner, repo: repoName } = this.parseRepo(repo);

    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    return this.parsePullRequest(data);
  }

  /**
   * Get the diff for a pull request
   */
  async getPullRequestDiff(prNumber: number, repo?: string): Promise<string> {
    const { owner, repo: repoName } = this.parseRepo(repo);

    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });

    return data as unknown as string;
  }

  /**
   * Get list of files changed in a PR
   */
  async getPullRequestFiles(
    prNumber: number,
    repo?: string
  ): Promise<ChangedFile[]> {
    const { owner, repo: repoName } = this.parseRepo(repo);

    const data = await this.octokit.paginate(
      this.octokit.rest.pulls.listFiles,
      {
        owner,
        repo: repoName,
        pull_number: prNumber,
        per_page: 100,
      }
    );

    return data.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    }));
  }

  /**
   * Update a pull request
   */
  async updatePullRequest(options: {
    prNumber: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    repo?: string;
  }): Promise<PullRequest> {
    const { owner, repo } = this.parseRepo(options.repo);

    const { data } = await this.octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: options.prNumber,
      title: options.title,
      body: options.body,
      state: options.state,
    });

    return this.parsePullRequest(data);
  }

  /**
   * List open pull requests
   */
  async listPullRequests(options?: {
    state?: 'open' | 'closed' | 'all';
    head?: string;
    base?: string;
    repo?: string;
  }): Promise<PullRequest[]> {
    const { owner, repo } = this.parseRepo(options?.repo);

    const { data } = await this.octokit.rest.pulls.list({
      owner,
      repo,
      state: options?.state || 'open',
      head: options?.head,
      base: options?.base,
      per_page: 100,
    });

    return data.map((pr) => this.parsePullRequest(pr));
  }

  // ==================== Review Operations ====================

  /**
   * Create a PR review with comments
   */
  async createReview(options: {
    prNumber: number;
    review: Review;
    repo?: string;
  }): Promise<{ id: number }> {
    const { owner, repo } = this.parseRepo(options.repo);

    // Format comments for API
    const comments = options.review.comments.map((comment) => {
      let body = comment.body;
      if (comment.suggestion) {
        body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
      }

      return {
        path: comment.path,
        line: comment.line,
        body,
        side: comment.side,
      };
    });

    const { data } = await this.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: options.prNumber,
      body: options.review.body,
      event: options.review.event,
      comments,
    });

    return { id: data.id };
  }

  /**
   * Add a general comment to a PR (not a review)
   */
  async addPRComment(options: {
    prNumber: number;
    body: string;
    repo?: string;
  }): Promise<{ id: number }> {
    const { owner, repo } = this.parseRepo(options.repo);

    const { data } = await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: options.prNumber,
      body: options.body,
    });

    return { id: data.id };
  }

  /**
   * Approve a pull request
   */
  async approvePR(options: {
    prNumber: number;
    body?: string;
    repo?: string;
  }): Promise<{ id: number }> {
    return this.createReview({
      prNumber: options.prNumber,
      review: {
        body: options.body || 'LGTM! Approved by Boatclaw.',
        event: 'APPROVE',
        comments: [],
      },
      repo: options.repo,
    });
  }

  /**
   * Request changes on a pull request
   */
  async requestChanges(options: {
    prNumber: number;
    body: string;
    comments: ReviewComment[];
    repo?: string;
  }): Promise<{ id: number }> {
    return this.createReview({
      prNumber: options.prNumber,
      review: {
        body: options.body,
        event: 'REQUEST_CHANGES',
        comments: options.comments,
      },
      repo: options.repo,
    });
  }

  /**
   * Close the client (no cleanup needed for Octokit)
   */
  async close(): Promise<void> {
    // No cleanup needed
  }

  private parsePullRequest(data: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    url: string;
    html_url: string;
    head: { ref: string };
    base: { ref: string };
    created_at: string;
    updated_at: string;
    merged?: boolean;
    merged_at?: string | null;
    mergeable?: boolean | null;
    diff_url: string;
  }): PullRequest {
    return {
      number: data.number,
      title: data.title,
      body: data.body || '',
      state: data.state as 'open' | 'closed',
      url: data.url,
      htmlUrl: data.html_url,
      headBranch: data.head.ref,
      baseBranch: data.base.ref,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      merged: data.merged === true || !!data.merged_at,
      mergeable: data.mergeable ?? null,
      diffUrl: data.diff_url,
    };
  }
}

/**
 * Create a GitHub client from config.
 */
export function createGitHubClient(options: {
  token: string;
  defaultRepo?: string;
}): GitHubClient {
  return new GitHubClient(options);
}
