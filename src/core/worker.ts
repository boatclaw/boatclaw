/**
 * Worker - polls the board for tasks and processes them.
 *
 * Polling loop:
 * 1. Fetch cards from trigger list
 * 2. Filter cards with matching role labels
 * 3. Process each card (move to working, execute, move to success/failed)
 * 4. Wait for poll interval
 * 5. Repeat
 */

import { EventEmitter } from 'events';
import { BoardProvider, Card } from '../platforms/types.js';
import { configManager, RoleConfig, WorkflowConfig, ProjectConfig } from './config.js';
import { workerLogger as log } from './logger.js';
import { createReviewerAgent } from '../github/reviewer.js';
import { GitHubClient } from '../github/client.js';
import { createAIProvider } from '../ai/index.js';

/**
 * Worker state.
 */
export type WorkerState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

/**
 * Single project processing result.
 */
export interface ProjectResult {
  projectName: string;
  success: boolean;
  error?: string;
  prUrl?: string;
  prNumber?: number;
}

/**
 * Task processing result.
 */
export interface TaskResult {
  cardId: string;
  cardTitle: string;
  role: string;
  success: boolean;
  error?: string;
  durationMs: number;
  prUrl?: string;
  // Multi-project support
  projectResults?: ProjectResult[];
  prUrls?: string[];
}

/**
 * Worker events.
 */
export interface WorkerEvents {
  stateChange: (state: WorkerState) => void;
  poll: (cardsFound: number) => void;
  taskStart: (card: Card, role: RoleConfig) => void;
  taskComplete: (result: TaskResult) => void;
  taskError: (card: Card, error: Error) => void;
  error: (error: Error) => void;
}

/**
 * Single project processing result from task processor.
 */
export interface ProjectProcessingNotification {
  projectName: string;
  success: boolean;
  error?: string;
  prUrl?: string;
  prNumber?: number;
  output?: string;
}

/**
 * Task processor function type.
 * Implemented in AI engine with optional GitHub PR creation.
 * Now supports multi-project processing.
 */
export type TaskProcessor = (
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  onProjectComplete?: (result: ProjectProcessingNotification) => Promise<void> | void,
  cardComments?: string,
  fetchComments?: (cardId: string) => Promise<string | undefined>,
  postComment?: (cardId: string, text: string) => Promise<void>,
) => Promise<{
  success: boolean;
  output: string;
  summary?: string;
  error?: string;
  projectResults?: ProjectResult[];
}>;

/**
 * Worker options.
 */
export interface WorkerOptions {
  provider: BoardProvider;
  pollIntervalMs?: number;
  maxParallelTasks?: number;
  dryRun?: boolean;
  taskProcessor?: TaskProcessor;
  /** GitHub token for review integration */
  githubToken?: string;
  /** Whether GitHub is enabled and working */
  githubEnabled?: boolean;
}

/**
 * Default task processor (placeholder until AI is implemented).
 */
const defaultTaskProcessor: TaskProcessor = async (card, role, projects, _onProjectComplete, _cardComments, _fetchComments, _postComment) => {
  // Simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const projectResults: ProjectResult[] = projects.map(p => ({
    projectName: p.name,
    success: true,
  }));

  return {
    success: true,
    output: `Task "${card.title}" processed by role "${role.name}" for ${projects.length} project(s) (placeholder)`,
    projectResults,
  };
};

/**
 * Worker class - manages the polling loop and task processing.
 */
export class Worker extends EventEmitter {
  private provider: BoardProvider;
  private pollIntervalMs: number;
  private maxParallelTasks: number;
  private dryRun: boolean;
  private taskProcessor: TaskProcessor;
  private githubToken?: string;
  private githubEnabled: boolean;

  private state: WorkerState = 'idle';
  private pollTimer: NodeJS.Timeout | null = null;
  private processingCards: Set<string> = new Set();
  private reviewingCards: Set<string> = new Set();
  private shouldStop: boolean = false;

  constructor(options: WorkerOptions) {
    super();
    this.provider = options.provider;
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.maxParallelTasks = options.maxParallelTasks ?? 10;
    this.dryRun = options.dryRun ?? false;
    this.taskProcessor = options.taskProcessor ?? defaultTaskProcessor;
    this.githubToken = options.githubToken;
    this.githubEnabled = options.githubEnabled ?? false;
  }

  /**
   * Get current worker state.
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Start the worker.
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    this.setState('starting');
    this.shouldStop = false;
    log.info('Worker starting', { pollIntervalMs: this.pollIntervalMs, maxParallelTasks: this.maxParallelTasks });

    try {
      // Verify connection
      const connected = await this.provider.verifyConnection();
      if (!connected) {
        log.error('Failed to connect to board provider');
        throw new Error('Failed to connect to board provider');
      }

      log.info('Connected to board provider');
      this.setState('running');

      // Start polling loop
      this.poll();
    } catch (error) {
      log.error('Worker failed to start', error);
      this.setState('stopped');
      throw error;
    }
  }

  /**
   * Stop the worker.
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      return;
    }

    log.info('Worker stopping', { inProgressTasks: this.processingCards.size });
    this.setState('stopping');
    this.shouldStop = true;

    // Clear poll timer
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for in-progress tasks and reviews to complete
    while (this.processingCards.size > 0 || this.reviewingCards.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    log.info('Worker stopped');
    this.setState('stopped');
  }

  /**
   * Poll for tasks and process them.
   */
  private async poll(): Promise<void> {
    if (this.shouldStop) {
      return;
    }

    try {
      const cards = await this.fetchTriggerCards();
      this.emit('poll', cards.length);

      // Process cards from trigger list
      for (const { card, role, projects } of cards) {
        if (this.shouldStop) {
          break;
        }

        // Skip if already processing
        if (this.processingCards.has(card.id)) {
          continue;
        }

        // Check parallel task limit
        if (this.processingCards.size >= this.maxParallelTasks) {
          break;
        }

        // Process task
        this.processTask(card, role, projects);
      }

      // Also check review list for cards that need automated review
      if (!this.shouldStop) {
        await this.pollReviewList();
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }

    // Schedule next poll
    if (!this.shouldStop) {
      this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
    }
  }

  /**
   * Fetch cards from trigger list that match configured engineers (roles).
   *
   * Flow:
   * 1. Get cards from trigger list
   * 2. Match card label to engineer (role)
   * 3. Get ALL projects the engineer is assigned to
   * 4. Return card + engineer + their projects
   */
  private async fetchTriggerCards(): Promise<{ card: Card; role: RoleConfig; projects: ProjectConfig[] }[]> {
    const config = configManager.load();
    const workflow = config.workflow;

    if (!workflow.triggerId) {
      return [];
    }

    // Get enabled engineers (roles)
    const enabledRoles = Object.values(config.roles).filter((r) => r.enabled);
    if (enabledRoles.length === 0) {
      return [];
    }

    // Fetch cards from trigger list
    const cards = await this.provider.getCards({
      listId: workflow.triggerId,
    });

    // Match cards to engineers and get their projects
    const result: { card: Card; role: RoleConfig; projects: ProjectConfig[] }[] = [];

    for (const card of cards) {
      const cardLabels = card.labels.map(l => l.name.toLowerCase());

      // Find matching engineer for this card (by label = engineer name)
      const matchingRole = configManager.findRoleForLabels(cardLabels);
      if (!matchingRole) {
        continue;
      }

      // Get ALL projects this engineer is assigned to
      const engineerProjects = this.getProjectsForRole(matchingRole, config.projects);

      // If no projects configured, check for legacy repoPath in role
      if (engineerProjects.length === 0 && matchingRole.repoPath) {
        // Legacy support: role has repoPath directly
        const legacyProject: ProjectConfig = {
          name: matchingRole.name,
          path: matchingRole.repoPath,
          baseBranch: 'main',
          branchPrefix: 'feature/',
        };
        engineerProjects.push(legacyProject);
      }

      if (engineerProjects.length > 0) {
        result.push({ card, role: matchingRole, projects: engineerProjects });
      } else {
        log.warn('Agent matched but has no valid projects', {
          cardId: card.id,
          cardTitle: card.title,
          agent: matchingRole.name,
          configuredProjects: matchingRole.projects,
        });
      }
    }

    return result;
  }

  /**
   * Get all projects an engineer (role) is assigned to.
   */
  private getProjectsForRole(role: RoleConfig, allProjects: Record<string, ProjectConfig>): ProjectConfig[] {
    const projects: ProjectConfig[] = [];

    // If role has "*", return all projects
    if (role.projects.includes('*')) {
      return Object.values(allProjects);
    }

    // Otherwise, return only the projects listed in role.projects
    for (const projectName of role.projects) {
      const project = allProjects[projectName];
      if (project) {
        projects.push(project);
      }
    }

    return projects;
  }

  /**
   * Process a single task across one or more projects.
   */
  private async processTask(card: Card, role: RoleConfig, projects: ProjectConfig[]): Promise<void> {
    this.processingCards.add(card.id);
    const startTime = Date.now();

    const projectNames = projects.map(p => p.name).join(', ');
    log.taskStart(card.id, card.title, role.name);
    log.info('Processing task', { cardId: card.id, projects: projectNames });
    this.emit('taskStart', card, role);

    try {
      const config = configManager.load();
      const workflow = config.workflow;

      // Move to working list
      if (!this.dryRun) {
        await this.moveCardToWorking(card, workflow);
      }

      // Fetch card comments for context (human discussion, follow-ups)
      // Done BEFORE the started comment so planning can use them
      let cardComments: string | undefined;
      try {
        cardComments = await this.fetchHumanComments(card.id);
      } catch {
        // Ignore comment fetch errors — not critical
      }

      // Add started comment
      if (!this.dryRun) {
        const projectList = projects.map(p => `- ${p.name}`).join('\n');
        await this.provider.addComment(
          card.id,
          `🤖 **Boatclaw started**\n\nProcessing with role: **${role.name}**\nModel: ${role.model}\n\n**Projects:**\n${projectList}`
        );
      }

      // Execute task across all projects, posting per-project updates
      const processingResult = await this.taskProcessor(card, role, projects, async (projectResult) => {
        if (!this.dryRun && projects.length > 1) {
          const status = projectResult.success ? '✅' : '❌';
          let msg = `${status} **${projectResult.projectName}** — ${projectResult.success ? 'completed' : 'failed'}`;
          if (projectResult.prUrl) {
            msg += ` — [PR #${projectResult.prNumber}](${projectResult.prUrl})`;
          }
          if (projectResult.error) {
            msg += `\n> ${projectResult.error}`;
          }
          // Include structured summary or brief output snippet
          if (projectResult.output) {
            const summaryMatch = projectResult.output.match(/\*\*What was done:?\*\*[\s\S]*?^---$/im);
            if (summaryMatch) {
              msg += `\n\n${summaryMatch[0].trim()}`;
            } else {
              // Fallback: show last meaningful lines of output
              const lines = projectResult.output.split('\n').filter(l => l.trim()).slice(-5);
              if (lines.length > 0) {
                msg += `\n\n**Output:**\n${lines.join('\n').slice(0, 500)}`;
              }
            }
          }
          try {
            await this.provider.addComment(card.id, msg);
          } catch {
            log.debug('Failed to post per-project update', { cardId: card.id, project: projectResult.projectName });
          }
        }
      }, cardComments, (cardId) => this.fetchHumanComments(cardId), async (cardId, text) => { await this.provider.addComment(cardId, text); });

      // Collect all PR URLs
      const prUrls = processingResult.projectResults
        ?.filter(r => r.prUrl)
        .map(r => r.prUrl!) || [];

      // Handle result
      if (processingResult.success) {
        await this.handleTaskSuccess(
          card,
          role,
          workflow,
          processingResult.summary || processingResult.output,
          prUrls.length > 0 ? prUrls[0] : undefined,
          processingResult.projectResults
        );
      } else {
        await this.handleTaskFailure(
          card,
          role,
          workflow,
          processingResult.error || 'Unknown error',
          processingResult.projectResults
        );
      }

      const durationMs = Date.now() - startTime;
      log.taskComplete(card.id, card.title, processingResult.success, durationMs, prUrls[0]);

      const result: TaskResult = {
        cardId: card.id,
        cardTitle: card.title,
        role: role.name,
        success: processingResult.success,
        error: processingResult.error,
        durationMs,
        prUrl: prUrls[0],
        prUrls,
        projectResults: processingResult.projectResults,
      };

      this.emit('taskComplete', result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.taskError(card.id, card.title, errorMessage);

      // Try to move to failed list
      try {
        const config = configManager.load();
        await this.handleTaskFailure(
          card,
          role,
          config.workflow,
          errorMessage
        );
      } catch {
        // Ignore errors in error handling
      }

      this.emit('taskError', card, error instanceof Error ? error : new Error(errorMessage));

      const result: TaskResult = {
        cardId: card.id,
        cardTitle: card.title,
        role: role.name,
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };

      this.emit('taskComplete', result);
    } finally {
      this.processingCards.delete(card.id);
    }
  }

  /**
   * Move card to working list.
   */
  private async moveCardToWorking(
    card: Card,
    workflow: WorkflowConfig
  ): Promise<void> {
    if (workflow.workingId) {
      await this.provider.moveCard(card.id, workflow.workingId);
    }
  }

  /**
   * Fetch human comments from a card, filtering out bot comments.
   * Returns formatted string or undefined if no human comments.
   */
  private async fetchHumanComments(cardId: string): Promise<string | undefined> {
    const comments = await this.provider.getComments(cardId);
    const humanComments = comments.filter(c => {
      const t = c.text;
      return !t.includes('**Boatclaw') &&
        !t.includes('**Task completed') &&
        !t.includes('**Task failed') &&
        !t.includes('**Code review') &&
        !t.includes('**Review passed') &&
        !t.includes('**Review found') &&
        !t.includes('**Automated review');
    });
    if (humanComments.length === 0) return undefined;
    return humanComments
      .map(c => `**${c.authorName}** (${c.createdAt.toISOString().split('T')[0]}):\n${c.text}`)
      .join('\n\n---\n\n')
      .slice(0, 5000);
  }

  /**
   * Handle successful task completion.
   */
  private async handleTaskSuccess(
    card: Card,
    role: RoleConfig,
    workflow: WorkflowConfig,
    output: string,
    prUrl?: string,
    projectResults?: ProjectResult[]
  ): Promise<void> {
    if (this.dryRun) {
      return;
    }

    // Build success comment with clear summary
    const parts: string[] = ['✅ **Task completed successfully**'];

    // Add AI output summary
    if (output) {
      parts.push(`**Summary:**\n${output.slice(0, 800)}`);
    }

    // Add per-project details
    if (projectResults && projectResults.length > 0) {
      const projectDetails = projectResults
        .map(r => {
          let line = `- **${r.projectName}:** ✅ Done`;
          if (r.prUrl) {
            line += ` — [PR #${r.prNumber}](${r.prUrl})`;
          } else {
            line += ' — changes applied locally (no GitHub PR)';
          }
          return line;
        })
        .join('\n');
      parts.push(`**Projects:**\n${projectDetails}`);

      // Separate PR links section for easy scanning
      const prLinks = projectResults
        .filter(r => r.prUrl)
        .map(r => `- **${r.projectName}:** ${r.prUrl}`)
        .join('\n');
      if (prLinks) {
        parts.push(`🔗 **Pull Requests:**\n${prLinks}`);
      }
    } else if (prUrl) {
      parts.push(`🔗 **Pull Request:** ${prUrl}`);
    }

    // Add role info
    parts.push(`_Processed by agent **${role.name}**_`);

    await this.provider.addComment(card.id, parts.join('\n\n'));

    // Always move to review list first if configured — reviewer will move to success/failed
    if (workflow.reviewId) {
      await this.provider.moveCard(card.id, workflow.reviewId);
    } else if (workflow.successId) {
      await this.provider.moveCard(card.id, workflow.successId);
    }
  }

  /**
   * Handle task failure.
   */
  private async handleTaskFailure(
    card: Card,
    role: RoleConfig,
    workflow: WorkflowConfig,
    error: string,
    projectResults?: ProjectResult[]
  ): Promise<void> {
    if (this.dryRun) {
      return;
    }

    // Build failure comment with clear details
    const parts: string[] = ['❌ **Task failed**', `**Error:** ${error.slice(0, 500)}`];

    if (projectResults && projectResults.length > 0) {
      const projectDetails = projectResults
        .map(r => {
          let line = `- **${r.projectName}:** ${r.success ? '✅ Done' : '❌ Failed'}`;
          if (r.error) line += ` — ${r.error}`;
          if (r.prUrl) line += ` — [PR #${r.prNumber}](${r.prUrl})`;
          return line;
        })
        .join('\n');
      parts.push(`**Project Results:**\n${projectDetails}`);
    }

    parts.push(`_Processed by agent **${role.name}**_`);

    await this.provider.addComment(card.id, parts.join('\n\n'));

    // Move to failed list if configured, otherwise back to trigger
    const targetList = workflow.failedId || workflow.triggerId;
    if (targetList) {
      await this.provider.moveCard(card.id, targetList);
    }
  }

  /**
   * Poll review list for cards that need automated review.
   * Cards with matching agent labels in the review list get auto-reviewed.
   * Works with and without GitHub.
   */
  private async pollReviewList(): Promise<void> {
    const config = configManager.load();
    const workflow = config.workflow;

    if (!workflow.reviewId) {
      return;
    }

    try {
      const cards = await this.provider.getCards({ listId: workflow.reviewId });

      for (const card of cards) {
        if (this.shouldStop) break;
        if (this.reviewingCards.has(card.id)) continue;

        // Only review cards that have a matching agent label
        const cardLabels = card.labels.map(l => l.name.toLowerCase());
        const matchingRole = configManager.findRoleForLabels(cardLabels);
        if (!matchingRole) continue;

        // Start review
        this.reviewCard(card, matchingRole, workflow, config).catch(err => {
          log.error('Unhandled review error', { cardId: card.id, error: err instanceof Error ? err.message : String(err) });
        });
      }
    } catch (error) {
      log.debug('Review list poll error', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Review a card and move it based on result.
   * Supports both GitHub (PR review) and local (git diff) modes.
   */
  private async reviewCard(
    card: Card,
    role: RoleConfig,
    workflow: WorkflowConfig,
    config: ReturnType<typeof configManager.load>
  ): Promise<void> {
    if (this.dryRun) return;

    this.reviewingCards.add(card.id);

    try {
      const aiProvider = createAIProvider({
        provider: (config.ai.provider || 'claude') as 'claude' | 'cursor' | 'codex',
        defaultModel: 'sonnet',
        timeoutSeconds: config.ai.timeoutSeconds || 1800,
      });

      // Find project and agent context
      const roleProjects = this.getProjectsForRole(role, config.projects);
      const project = roleProjects[0]; // Use first project for context
      const projectContext = project?.context;
      const agentContext = role.context;

      // Check if this card has PRs (GitHub mode) or is local
      const comments = await this.provider.getComments(card.id);
      const prComment = comments.find(c => c.text?.includes('**Pull Requests:**') || c.text?.includes('**Pull Request:**'));

      // Format all non-bot comments for review context
      const humanComments = comments.filter(c => {
          const t = c.text;
          return !t.includes('**Boatclaw') &&
            !t.includes('**Task completed') &&
            !t.includes('**Task failed') &&
            !t.includes('**Code review') &&
            !t.includes('**Review passed') &&
            !t.includes('**Review found') &&
            !t.includes('**Automated review');
        });
      const ticketComments = humanComments.length > 0
        ? humanComments.map(c => `**${c.authorName}** (${c.createdAt.toISOString().split('T')[0]}):\n${c.text}`).join('\n\n---\n\n').slice(0, 5000)
        : undefined;

      // Get the developer agent's completion comment — reviewer always needs this
      const agentCompletionComment = comments.find(c =>
        c.text?.includes('**Task completed successfully**') ||
        c.text?.includes('**Task failed**')
      );

      // Collect all review results — move card only after all reviews complete
      const reviewResults: { name: string; approved: boolean }[] = [];

      // Find ALL PR URLs in comments (multi-project tasks have multiple PRs)
      const allPrMatches = prComment?.text?.matchAll(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/g);
      const prList = allPrMatches ? [...allPrMatches].map(m => ({ repo: m[1], prNumber: parseInt(m[2], 10) })) : [];

      if (prList.length > 0 && this.githubToken) {
        // GitHub mode: review each PR separately with error isolation
        for (const pr of prList) {
          try {
            const prProject = Object.values(config.projects).find(p => p.github === pr.repo);

            const githubClient = new GitHubClient({ token: this.githubToken, defaultRepo: pr.repo });
            const reviewer = createReviewerAgent({
              boardProvider: this.provider,
              aiProvider,
              githubClient,
              workflow,
            });

            log.info('Starting PR review', { cardId: card.id, prNumber: pr.prNumber, repo: pr.repo });

            const result = await reviewer.processCardForReview({
              card,
              prNumber: pr.prNumber,
              repo: pr.repo,
              projectContext: prProject?.context || projectContext,
              agentContext,
              ticketComments,
              agentComment: agentCompletionComment?.text,
            });

            reviewResults.push({ name: pr.repo, approved: result.approved });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error('PR review failed', { cardId: card.id, prNumber: pr.prNumber, error: msg });
            await this.provider.addComment(card.id, `⚠️ **Review failed for PR #${pr.prNumber}:** ${msg}`);
            reviewResults.push({ name: pr.repo, approved: false });
          }
        }
      } else {
        // Local mode: review each project's changes with error isolation
        const projectsToReview = roleProjects.length > 0 ? roleProjects : (project ? [project] : []);

        for (const proj of projectsToReview) {
          try {
            const reviewer = createReviewerAgent({
              boardProvider: this.provider,
              aiProvider,
              workflow,
            });

            log.info('Starting local review', { cardId: card.id, project: proj.name });

            const result = await reviewer.processCardForLocalReview({
              card,
              projectPath: proj.path || process.cwd(),
              baseBranch: proj.baseBranch || 'main',
              projectContext: proj.context || projectContext,
              agentContext,
              agentComment: agentCompletionComment?.text,
              ticketComments,
            });

            reviewResults.push({ name: proj.name, approved: result.approved });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error('Local review failed', { cardId: card.id, project: proj.name, error: msg });
            await this.provider.addComment(card.id, `⚠️ **Review failed for ${proj.name}:** ${msg}`);
            reviewResults.push({ name: proj.name, approved: false });
          }
        }
      }

      // Move card based on aggregated review results — all must pass
      const allApproved = reviewResults.length > 0 && reviewResults.every(r => r.approved);

      if (allApproved) {
        if (workflow.successId) {
          await this.provider.moveCard(card.id, workflow.successId);
        }
      } else {
        if (workflow.failedId) {
          await this.provider.moveCard(card.id, workflow.failedId);
        }
      }

      log.info('Review completed', { cardId: card.id, allApproved, results: reviewResults });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Review failed', { cardId: card.id, error: msg });
      await this.provider.addComment(card.id, `⚠️ **Automated review failed:** ${msg}`);
      // Move to failed to prevent infinite retry loop
      if (workflow.failedId) {
        try {
          await this.provider.moveCard(card.id, workflow.failedId);
        } catch { /* ignore move errors */ }
      }
    } finally {
      this.reviewingCards.delete(card.id);
    }
  }

  /**
   * Set worker state and emit event.
   */
  private setState(state: WorkerState): void {
    this.state = state;
    this.emit('stateChange', state);
  }
}

/**
 * Create a worker instance from configuration.
 */
export function createWorker(
  provider: BoardProvider,
  options?: Partial<WorkerOptions>
): Worker {
  const config = configManager.load();

  return new Worker({
    provider,
    pollIntervalMs: options?.pollIntervalMs ?? (config.worker.pollInterval || 3) * 1000,
    maxParallelTasks: options?.maxParallelTasks ?? (config.worker.maxParallelTasks || 10),
    dryRun: options?.dryRun ?? config.worker.dryRun,
    taskProcessor: options?.taskProcessor,
    githubToken: options?.githubToken,
    githubEnabled: options?.githubEnabled,
  });
}
