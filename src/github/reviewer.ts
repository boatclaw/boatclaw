/**
 * Reviewer Agent - performs automated code reviews.
 *
 * Two modes:
 * - GitHub mode: reviews PR diff, submits review on GitHub
 * - Local mode: reviews git diff from project path + agent comment on ticket
 */

import { execSync } from 'child_process';
import { BoardProvider, Card } from '../platforms/types.js';
import { AIProvider, Model } from '../ai/types.js';
import { GitHubClient, ReviewComment, ChangedFile } from './client.js';
import { WorkflowConfig } from '../core/config.js';

/**
 * Result of code review
 */
export interface ReviewResult {
  approved: boolean;
  summary: string;
  issues: string[];
  lineComments: ReviewComment[];
  rawOutput: string;
}

/**
 * Reviewer agent options
 */
export interface ReviewerOptions {
  boardProvider: BoardProvider;
  aiProvider: AIProvider;
  githubClient?: GitHubClient;
  workflow: WorkflowConfig;
  defaultModel?: Model;
}

/**
 * Reviewer agent that performs automated code reviews
 */
export class ReviewerAgent {
  private board: BoardProvider;
  private ai: AIProvider;
  private github?: GitHubClient;
  private workflow: WorkflowConfig;
  private defaultModel: Model;

  constructor(options: ReviewerOptions) {
    this.board = options.boardProvider;
    this.ai = options.aiProvider;
    this.github = options.githubClient;
    this.workflow = options.workflow;
    this.defaultModel = options.defaultModel || 'sonnet';
  }

  /**
   * Select model based on diff size
   */
  private selectModelForReview(diffSize: number): Model {
    // Small diffs: use faster model
    if (diffSize < 200) {
      return 'haiku';
    }
    // Large diffs: use more capable model
    if (diffSize > 1000) {
      return 'opus';
    }
    // Medium diffs: use default
    return this.defaultModel;
  }

  /**
   * Review a pull request
   */
  async reviewPR(options: {
    card: Card;
    prNumber: number;
    repo?: string;
    timeoutMs?: number;
    projectContext?: string;
    agentContext?: string;
  }): Promise<ReviewResult> {
    const { card, prNumber, repo, timeoutMs = 900000, projectContext, agentContext } = options;

    try {
      if (!this.github) {
        throw new Error('GitHub client is required for PR review. Use reviewLocal() for non-GitHub reviews.');
      }

      // Get PR diff
      const diff = await this.github.getPullRequestDiff(prNumber, repo);

      // Get changed files for context
      const files = await this.github.getPullRequestFiles(prNumber, repo);
      const diffSize = files.reduce((sum, f) => sum + f.changes, 0);

      // Select model based on diff size
      const model = this.selectModelForReview(diffSize);

      // Build review prompt
      const prompt = this.buildReviewPrompt(card, diff, files, projectContext, agentContext);

      // Execute AI
      const result = await this.ai.execute({
        prompt,
        workingDir: process.cwd(),
        model,
        timeoutMs,
      });

      if (!result.success) {
        return {
          approved: false,
          summary: 'Review failed due to AI error',
          issues: [result.error || 'Unknown error'],
          lineComments: [],
          rawOutput: result.output,
        };
      }

      // Parse review output
      const reviewResult = this.parseReviewOutput(result.output, files);

      return reviewResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        approved: false,
        summary: `Review failed: ${errorMessage}`,
        issues: [errorMessage],
        lineComments: [],
        rawOutput: '',
      };
    }
  }

  /**
   * Submit the review to GitHub
   */
  async submitReview(options: {
    prNumber: number;
    reviewResult: ReviewResult;
    repo?: string;
  }): Promise<void> {
    const { prNumber, reviewResult, repo } = options;

    if (!this.github) {
      return;
    }

    if (reviewResult.approved) {
      await this.github.approvePR({
        prNumber,
        body: `✅ **Approved**\n\n${reviewResult.summary}`,
        repo,
      });
    } else {
      // Format body with issues
      const bodyParts = [
        `❌ **Changes Requested**\n\n${reviewResult.summary}`,
        '',
        '## Issues Found',
        '',
        ...reviewResult.issues.map((issue) => `- ${issue}`),
      ];

      await this.github.requestChanges({
        prNumber,
        body: bodyParts.join('\n'),
        comments: reviewResult.lineComments,
        repo,
      });
    }
  }

  /**
   * Process a card for code review
   */
  async processCardForReview(options: {
    card: Card;
    prNumber: number;
    repo?: string;
    projectContext?: string;
    agentContext?: string;
  }): Promise<ReviewResult> {
    const { card, prNumber, repo, projectContext, agentContext } = options;

    // Add started comment
    await this.board.addComment(
      card.id,
      `🔍 **Boatclaw starting code review**\n\nReviewing PR #${prNumber}...`
    );

    // Perform review
    const result = await this.reviewPR({ card, prNumber, repo, projectContext, agentContext });

    // Submit to GitHub
    await this.submitReview({ prNumber, reviewResult: result, repo });

    // Update board card
    if (result.approved) {
      const comment = `✅ **Code review passed**

**Summary:** ${result.summary}

The PR has been approved and is ready for human review and merge.
`;
      await this.board.addComment(card.id, comment);

      // Move to success state
      if (this.workflow.successId) {
        await this.board.moveCard(card.id, this.workflow.successId);
      }
    } else {
      const issuesText = result.issues.map((issue) => `- ${issue}`).join('\n');
      const comment = `❌ **Code review found issues**

**Summary:** ${result.summary}

**Issues:**
${issuesText}

Please address the issues and update the PR.
`;
      await this.board.addComment(card.id, comment);

      // Move to failed/needs-work state
      if (this.workflow.failedId) {
        await this.board.moveCard(card.id, this.workflow.failedId);
      }
    }

    return result;
  }

  /**
   * Review local changes (no GitHub).
   * Checks git diff in project path + agent comment on ticket.
   */
  async reviewLocal(options: {
    card: Card;
    projectPath: string;
    baseBranch?: string;
    projectContext?: string;
    agentContext?: string;
    agentComment?: string;
    timeoutMs?: number;
  }): Promise<ReviewResult> {
    const { card, projectPath, baseBranch = 'main', projectContext, agentContext, agentComment, timeoutMs = 900000 } = options;

    try {
      // Get diff against base branch — catches both committed and uncommitted changes
      let diff = '';
      // Validate baseBranch to prevent command injection
      const safeBranch = /^[a-zA-Z0-9._\/-]+$/.test(baseBranch) ? baseBranch : 'main';
      try {
        // First try diffing against the base branch (catches committed changes)
        diff = execSync(`git diff ${safeBranch}...HEAD`, { cwd: projectPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      } catch {
        // Fallback: try uncommitted changes only
        try {
          diff = execSync('git diff', { cwd: projectPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        } catch {
          // No git or no changes — might be an investigation task
        }
      }

      // Get agent's comment from the ticket
      let agentOutput = agentComment || '';
      if (!agentOutput) {
        const comments = await this.board.getComments(card.id);
        const botComment = comments.find(c =>
          c.text?.includes('**Task completed successfully**') ||
          c.text?.includes('**Task failed**')
        );
        if (botComment) {
          agentOutput = botComment.text || '';
        }
      }

      // Use line count for model selection (consistent with GitHub mode which uses file change count)
      const diffLines = diff ? diff.split('\n').length : 0;
      const model = this.selectModelForReview(diffLines);

      // Build review prompt for local mode
      const prompt = this.buildLocalReviewPrompt(card, diff, agentOutput, projectContext, agentContext);

      const result = await this.ai.execute({
        prompt,
        workingDir: projectPath,
        model,
        timeoutMs,
      });

      if (!result.success) {
        return {
          approved: false,
          summary: 'Review failed due to AI error',
          issues: [result.error || 'Unknown error'],
          lineComments: [],
          rawOutput: result.output,
        };
      }

      return this.parseReviewOutput(result.output, []);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        approved: false,
        summary: `Review failed: ${errorMessage}`,
        issues: [errorMessage],
        lineComments: [],
        rawOutput: '',
      };
    }
  }

  /**
   * Process a card for local review (no GitHub).
   * Reviews code changes and agent comment, then moves card.
   */
  async processCardForLocalReview(options: {
    card: Card;
    projectPath: string;
    baseBranch?: string;
    projectContext?: string;
    agentContext?: string;
    agentComment?: string;
  }): Promise<ReviewResult> {
    const { card, projectPath, baseBranch, projectContext, agentContext, agentComment } = options;

    await this.board.addComment(
      card.id,
      `🔍 **Boatclaw starting review**\n\nReviewing changes in project...`
    );

    const result = await this.reviewLocal({ card, projectPath, baseBranch, projectContext, agentContext, agentComment });

    if (result.approved) {
      await this.board.addComment(card.id, `✅ **Review passed**\n\n**Summary:** ${result.summary}`);
      if (this.workflow.successId) {
        await this.board.moveCard(card.id, this.workflow.successId);
      }
    } else {
      const issuesText = result.issues.map(i => `- ${i}`).join('\n');
      await this.board.addComment(card.id, `❌ **Review found issues**\n\n**Summary:** ${result.summary}\n\n**Issues:**\n${issuesText}`);
      if (this.workflow.failedId) {
        await this.board.moveCard(card.id, this.workflow.failedId);
      }
    }

    return result;
  }

  private buildLocalReviewPrompt(
    card: Card,
    diff: string,
    agentComment: string,
    projectContext?: string,
    agentContext?: string,
  ): string {
    const sections: string[] = [];

    sections.push(`You are an expert code reviewer. Review the work done for the following task.`);

    if (projectContext) {
      sections.push(`## Project Context\n${projectContext}`);
    }

    if (agentContext) {
      sections.push(`## Agent Instructions\n${agentContext}`);
    }

    sections.push(`## Task\n**Title:** ${card.title}\n**Description:** ${card.description || 'No description provided'}`);

    if (agentComment) {
      sections.push(`## Agent's Report\nThe AI agent posted this update after working on the task:\n\n${agentComment.slice(0, 3000)}`);
    }

    if (diff) {
      sections.push(`## Code Changes\n\`\`\`diff\n${diff.slice(0, 50000)}\n\`\`\``);
    } else {
      sections.push(`## Code Changes\nNo code changes were made. This may be an investigation or documentation task. Review the agent's report above to verify the task was completed correctly.`);
    }

    sections.push(`## Review Instructions
1. Verify the work matches what the task asked for
2. If there are code changes: check for bugs, security issues, and code quality
3. If there are no code changes: verify the agent's report adequately addresses the task
4. Check that the agent's comment is clear and accurate${projectContext ? '\n5. Check that changes follow the project conventions' : ''}

## Output Format
Provide your review in EXACTLY this format:

APPROVED: yes | no
SUMMARY: <One sentence summary of your review>
ISSUES:
- <Issue 1 description>
- <Issue 2 description>

If approved, ISSUES can be empty.`);

    return sections.join('\n\n');
  }

  private buildReviewPrompt(
    card: Card,
    diff: string,
    files: ChangedFile[],
    projectContext?: string,
    agentContext?: string,
  ): string {
    const fileList = files
      .map((f) => `- ${f.filename} (+${f.additions} -${f.deletions})`)
      .join('\n');

    const sections: string[] = [];

    sections.push(`You are an expert code reviewer. Review the following pull request.`);

    // Add project context so the reviewer understands the codebase
    if (projectContext) {
      sections.push(`## Project Context
${projectContext}`);
    }

    // Add agent context so the reviewer follows team conventions
    if (agentContext) {
      sections.push(`## Agent Instructions
${agentContext}`);
    }

    sections.push(`## Task
**Title:** ${card.title}
**Description:** ${card.description || 'No description provided'}

## Files Changed
${fileList}

## Diff
\`\`\`diff
${diff.slice(0, 50000)}
\`\`\`

## Review Instructions
1. Check for bugs and logic errors
2. Check for security vulnerabilities
3. Check for performance issues
4. Check code style and readability
5. Check for missing error handling
6. Check for missing tests (if applicable)${projectContext ? '\n7. Check that changes follow the project conventions described above' : ''}

## Output Format
Provide your review in EXACTLY this format:

APPROVED: yes | no
SUMMARY: <One sentence summary of your review>
ISSUES:
- <Issue 1 description>
- <Issue 2 description>
LINE_COMMENTS:
- FILE: <filename>
  LINE: <line number>
  COMMENT: <your comment>
  SUGGESTION: <optional suggested code fix>

If approved, ISSUES and LINE_COMMENTS can be empty.
`);

    return sections.join('\n\n');
  }

  private parseReviewOutput(
    output: string,
    files: ChangedFile[]
  ): ReviewResult {
    // Default values
    let approved = false;
    let summary = 'Review completed';
    const issues: string[] = [];
    const lineComments: ReviewComment[] = [];

    // Parse APPROVED
    const approvedMatch = output.match(/APPROVED:\s*(yes|no)/i);
    if (approvedMatch) {
      approved = approvedMatch[1].toLowerCase() === 'yes';
    }

    // Parse SUMMARY
    const summaryMatch = output.match(
      /SUMMARY:\s*(.+?)(?=\n(?:ISSUES:|LINE_COMMENTS:|$))/s
    );
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    // Parse ISSUES
    const issuesMatch = output.match(/ISSUES:\s*\n((?:[-•]\s*.+\n?)+)/);
    if (issuesMatch) {
      const issuesText = issuesMatch[1];
      for (const line of issuesText.split('\n')) {
        const trimmed = line.trim().replace(/^[-•]\s*/, '');
        if (trimmed && trimmed !== '-' && trimmed !== '•') {
          issues.push(trimmed);
        }
      }
    }

    // Parse LINE_COMMENTS
    const linePattern =
      /FILE:\s*(.+?)\s*\n\s*LINE:\s*(\d+)\s*\n\s*COMMENT:\s*(.+?)(?:\n\s*SUGGESTION:\s*(.+?))?(?=\n\s*-?\s*FILE:|\n\n|$)/gs;
    let match;
    while ((match = linePattern.exec(output)) !== null) {
      const filePath = match[1].trim();
      const lineNum = parseInt(match[2], 10);
      const comment = match[3].trim();
      const suggestion = match[4]?.trim();

      // Validate file exists in PR
      if (files.some((f) => f.filename === filePath)) {
        lineComments.push({
          path: filePath,
          line: lineNum,
          body: comment,
          side: 'RIGHT',
          suggestion,
        });
      }
    }

    return {
      approved,
      summary,
      issues,
      lineComments,
      rawOutput: output,
    };
  }
}

/**
 * Create a reviewer agent.
 */
export function createReviewerAgent(options: ReviewerOptions): ReviewerAgent {
  return new ReviewerAgent(options);
}
