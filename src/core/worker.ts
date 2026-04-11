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
 * Task processor function type.
 * Implemented in AI engine with optional GitHub PR creation.
 * Now supports multi-project processing.
 */
export type TaskProcessor = (
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[]
) => Promise<{
  success: boolean;
  output: string;
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
}

/**
 * Default task processor (placeholder until AI is implemented).
 */
const defaultTaskProcessor: TaskProcessor = async (card, role, projects) => {
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

  private state: WorkerState = 'idle';
  private pollTimer: NodeJS.Timeout | null = null;
  private processingCards: Set<string> = new Set();
  private shouldStop: boolean = false;

  constructor(options: WorkerOptions) {
    super();
    this.provider = options.provider;
    this.pollIntervalMs = options.pollIntervalMs ?? 3000; // Default 3 seconds
    this.maxParallelTasks = options.maxParallelTasks ?? 10; // Default 10 parallel tasks
    this.dryRun = options.dryRun ?? false;
    this.taskProcessor = options.taskProcessor ?? defaultTaskProcessor;
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

    // Wait for in-progress tasks to complete
    while (this.processingCards.size > 0) {
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

      // Process cards
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
          // Wait for current tasks to complete
          break;
        }

        // Process task
        this.processTask(card, role, projects);
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

      // Add started comment with projects info
      if (!this.dryRun) {
        const projectList = projects.map(p => `- ${p.name}`).join('\n');
        await this.provider.addComment(
          card.id,
          `🤖 **Boatclaw started**\n\nProcessing with role: **${role.name}**\nModel: ${role.model}\n\n**Projects:**\n${projectList}`
        );
      }

      // Execute task across all projects
      const processingResult = await this.taskProcessor(card, role, projects);

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
          processingResult.output,
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

    // Build success comment
    let comment = `✅ **Task completed successfully**\n\n${output.slice(0, 800)}`;

    // Add all PR links if created (multi-project support)
    if (projectResults && projectResults.length > 0) {
      const prLinks = projectResults
        .filter(r => r.prUrl)
        .map(r => `- **${r.projectName}:** ${r.prUrl}`)
        .join('\n');

      if (prLinks) {
        comment += `\n\n🔗 **Pull Requests:**\n${prLinks}`;
      }
    } else if (prUrl) {
      comment += `\n\n🔗 **Pull Request:** ${prUrl}`;
    }

    await this.provider.addComment(card.id, comment);

    // Move to review list if any PR was created and review list is configured
    const hasPRs = projectResults?.some(r => r.prUrl) || !!prUrl;
    if (hasPRs && workflow.reviewId) {
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

    // Build failure comment with per-project details
    let comment = `❌ **Task failed**\n\n**Error:** ${error.slice(0, 500)}`;

    if (projectResults && projectResults.length > 0) {
      const projectDetails = projectResults
        .map(r => `- **${r.projectName}:** ${r.success ? '✅ Success' : '❌ Failed'}${r.error ? ` - ${r.error}` : ''}${r.prUrl ? ` (PR: ${r.prUrl})` : ''}`)
        .join('\n');
      comment += `\n\n**Project Results:**\n${projectDetails}`;
    }

    await this.provider.addComment(card.id, comment);

    // Move to failed list if configured, otherwise back to trigger
    const targetList = workflow.failedId || workflow.triggerId;
    if (targetList) {
      await this.provider.moveCard(card.id, targetList);
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
    pollIntervalMs: (config.worker.pollInterval || 3) * 1000,
    maxParallelTasks: config.worker.maxParallelTasks || 10,
    dryRun: config.worker.dryRun || options?.dryRun,
    taskProcessor: options?.taskProcessor,
    ...options,
  });
}
