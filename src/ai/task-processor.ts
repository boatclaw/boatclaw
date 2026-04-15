/**
 * AI Task Processor.
 *
 * Processes tasks from the board using AI providers.
 * Handles prompt building, model selection, and execution.
 * Supports multi-project tasks (one card → multiple PRs).
 */

import { Card } from '../platforms/types.js';
import { RoleConfig, ProjectConfig, configManager } from '../core/config.js';
import { AIProvider, Model } from './types.js';
import { buildPrompt, createTaskContext } from './prompt-builder.js';
import { selectModel, ModelSelection } from './model-selector.js';
import { createAIProvider } from './index.js';
import { PRManager, PRCreationResult } from '../github/pr-manager.js';
import { GitHubClient } from '../github/client.js';
import { WorktreeManager } from '../github/worktree.js';
import { aiLogger as log } from '../core/logger.js';
import { ProjectResult } from '../core/worker.js';
import { planTask, TaskPlan } from './planner.js';

/**
 * Single project processing result.
 */
export interface ProjectProcessingResult {
  projectName: string;
  success: boolean;
  output: string;
  error?: string;
  model: string;
  modelSelection?: ModelSelection;
  durationMs: number;
  prUrl?: string;
  prNumber?: number;
}

/**
 * Task processing result (aggregated across all projects).
 */
export interface TaskProcessingResult {
  success: boolean;
  output: string;
  summary?: string;
  error?: string;
  durationMs: number;
  plan?: TaskPlan;
  projectResults: ProjectProcessingResult[];
}

/**
 * Task processor options.
 */
export interface TaskProcessorOptions {
  provider?: AIProvider;
  additionalInstructions?: string;
  dryRun?: boolean;
  createPRs?: boolean;
  githubToken?: string;
  /** Enable interactive mode (ask_human) - only works with Claude */
  interactive?: boolean;
  /** Called after each project completes in multi-project tasks */
  onProjectComplete?: (result: ProjectProcessingResult) => Promise<void> | void;
}

/**
 * AI Task Processor class.
 *
 * Handles the full workflow of processing a task across multiple projects:
 * 1. For each project:
 *    a. Prepare worktree (if GitHub enabled)
 *    b. Build context from card, role, and project
 *    c. Select appropriate model
 *    d. Build prompt
 *    e. Execute with AI provider
 *    f. Create PR (if GitHub enabled)
 * 2. Aggregate results
 */
export class TaskProcessor {
  private baseProvider: AIProvider;
  private createPRs: boolean;
  private githubToken?: string;
  private dryRun: boolean;
  private interactive: boolean;

  constructor(options?: TaskProcessorOptions) {
    this.interactive = options?.interactive ?? false;

    // Create base provider from config if not provided
    if (options?.provider) {
      this.baseProvider = options.provider;
    } else {
      const config = configManager.load();
      this.baseProvider = createAIProvider({
        provider: config.ai.provider,
        defaultModel: config.ai.defaultModel as Model,
        timeoutSeconds: config.ai.timeoutSeconds,
        // Note: interactive mode requires card-specific provider, created in getProviderForCard
      });
    }

    this.createPRs = options?.createPRs ?? false;
    this.githubToken = options?.githubToken;
    this.dryRun = options?.dryRun ?? false;
  }

  /**
   * Get AI provider for a specific card.
   * For interactive mode with Claude, creates a provider with MCP config.
   */
  private getProviderForCard(cardId: string): AIProvider {
    // Only Claude supports interactive mode
    log.info('getProviderForCard called', {
      cardId,
      interactive: this.interactive,
      baseProviderName: this.baseProvider.name,
    });

    if (this.interactive && this.baseProvider.name === 'claude') {
      const config = configManager.load();
      log.info('Creating interactive Claude provider with MCP', {
        cardId,
        platform: config.platform,
      });
      return createAIProvider({
        provider: 'claude',
        defaultModel: config.ai.defaultModel as Model,
        timeoutSeconds: config.ai.timeoutSeconds,
        interactive: true,
        mcpConfig: {
          cardId,
          boardProvider: config.platform as 'trello' | 'jira' | 'linear',
        },
      });
    }

    return this.baseProvider;
  }

  /**
   * Process a task across multiple projects.
   *
   * @param card - The card/task to process
   * @param role - The role configuration
   * @param projects - Projects to work on
   * @param options - Additional options
   * @returns Aggregated processing result
   */
  async processMultiProject(
    card: Card,
    role: RoleConfig,
    projects: ProjectConfig[],
    options?: {
      additionalInstructions?: string;
      cardComments?: string;
      dryRun?: boolean;
      fetchComments?: (cardId: string) => Promise<string | undefined>;
      /** Post a comment to the ticket (for plan updates, etc.) */
      postComment?: (cardId: string, text: string) => Promise<void>;
      onProjectComplete?: (result: ProjectProcessingResult) => Promise<void> | void;
    }
  ): Promise<TaskProcessingResult> {
    const startTime = Date.now();
    const projectResults: ProjectProcessingResult[] = [];
    const outputs: string[] = [];
    let hasAnySuccess = false;
    let hasAnyFailure = false;

    log.info('Processing multi-project task', {
      cardId: card.id,
      projects: projects.map(p => p.name).join(', '),
      role: role.name,
    });

    // Planning phase — decide which projects need changes and in what order
    let plan: TaskPlan | undefined;
    let projectsToProcess = projects;

    if (projects.length > 1) {
      plan = await planTask(card, role, projects, this.baseProvider, options?.cardComments);

      // Filter and reorder projects based on plan
      const plannedProjects = plan.projects
        .map(name => projects.find(p => p.name.toLowerCase() === name.toLowerCase()))
        .filter((p): p is ProjectConfig => p !== undefined);

      if (plannedProjects.length > 0) {
        projectsToProcess = plannedProjects;
        log.info('Planning decided', {
          scope: plan.scope,
          projects: plan.projects.join(', '),
          reasoning: plan.reasoning,
          skipped: projects.filter(p => !plan!.projects.some(pp => pp.toLowerCase() === p.name.toLowerCase())).map(p => p.name).join(', ') || 'none',
        });
      }
    }

    // Post plan decision to ticket for transparency
    if (plan && options?.postComment) {
      const skipped = projects
        .filter(p => !plan!.projects.some(pp => pp.toLowerCase() === p.name.toLowerCase()))
        .map(p => p.name);

      let planMsg = `📋 **Planning complete**\n\n**Scope:** ${plan.scope}\n**Order:** ${plan.projects.join(' → ')}`;
      if (skipped.length > 0) {
        planMsg += `\n**Skipped:** ${skipped.join(', ')}`;
      }
      if (plan.sharedContracts) {
        planMsg += `\n**Shared contracts:** Yes — will abort remaining projects if a dependency fails`;
      }
      planMsg += `\n**Reasoning:** ${plan.reasoning}`;
      if (plan.executionNotes) {
        planMsg += `\n**Notes:** ${plan.executionNotes}`;
      }

      try {
        await options.postComment(card.id, planMsg);
      } catch {
        log.debug('Failed to post plan comment', { cardId: card.id });
      }
    }

    // Track previous project results for cross-project context
    const previousResults: { name: string; summary: string }[] = [];

    for (const project of projectsToProcess) {
      log.info(`Processing project: ${project.name}`, { cardId: card.id });

      // Re-fetch comments before each project session to include updates from previous projects
      let currentComments = options?.cardComments;
      if (options?.fetchComments && previousResults.length > 0) {
        try {
          const freshComments = await options.fetchComments(card.id);
          if (freshComments) {
            currentComments = freshComments;
          }
        } catch {
          log.debug('Failed to re-fetch comments, using existing', { cardId: card.id });
        }
      }

      // Build instructions with plan context + previous project results
      const instructionParts: string[] = [];

      if (options?.additionalInstructions) {
        instructionParts.push(options.additionalInstructions);
      }

      if (plan?.scope === 'cross-project') {
        instructionParts.push(`This is a cross-project task. Projects involved: ${plan.projects.join(', ')}.`);
      }
      if (plan?.sharedContracts) {
        instructionParts.push('Shared contracts/APIs/schemas are involved — ensure compatibility.');
      }
      if (plan?.executionNotes) {
        instructionParts.push(plan.executionNotes);
      }

      // Pass previous project results so the AI knows what was already done
      if (previousResults.length > 0) {
        const prevContext = previousResults
          .map(r => `**${r.name}** completed:\n${r.summary}`)
          .join('\n\n');
        instructionParts.push(`## Changes already made in other projects\n\nThe following projects were already processed for this task. Use this information to ensure your changes are compatible:\n\n${prevContext}`);
      }

      const planInstructions = instructionParts.length > 0 ? instructionParts.join('\n\n') : undefined;

      const projectResult = await this.processProject(
        card,
        role,
        project,
        { ...options, additionalInstructions: planInstructions, cardComments: currentComments }
      );

      projectResults.push(projectResult);
      outputs.push(`## ${project.name}\n${projectResult.output}`);

      // Track result for next project's context — use generous summary for cross-project
      if (projectResult.success) {
        // Try structured summary first, fallback to last 2000 chars of output
        const structuredMatch = projectResult.output.match(/\*\*What was done:?\*\*[\s\S]*?^---$/im);
        const summary = structuredMatch
          ? structuredMatch[0].trim()
          : projectResult.output.slice(-2000).trim();
        previousResults.push({ name: project.name, summary });
      }

      // Notify caller after each project completes
      if (options?.onProjectComplete) {
        await options.onProjectComplete(projectResult);
      }

      if (projectResult.success) {
        hasAnySuccess = true;
      } else {
        hasAnyFailure = true;

        // Abort remaining projects if this is a cross-project task with shared contracts
        if (plan?.scope === 'cross-project' && plan?.sharedContracts) {
          const currentIndex = projectsToProcess.indexOf(project);
          const remaining = projectsToProcess.slice(currentIndex + 1).map(p => p.name);

          if (remaining.length > 0) {
            log.warn('Aborting remaining projects due to dependency failure', {
              failedProject: project.name,
              remainingProjects: remaining.join(', '),
            });

            if (options?.postComment) {
              try {
                await options.postComment(card.id,
                  `⚠️ **Aborting remaining projects** (${remaining.join(', ')})\n\n` +
                  `**${project.name}** failed and has shared contracts with downstream projects. ` +
                  `Continuing would produce incompatible changes.`
                );
              } catch { /* ignore */ }
            }
          }
          break;
        }
      }
    }

    // Aggregate results — success if at least one project succeeded
    // A project with no changes is still a success (e.g., backend-only task on frontend project)
    const totalDuration = Date.now() - startTime;
    const overallSuccess = hasAnySuccess;

    const fullOutput = outputs.join('\n\n');

    return {
      success: overallSuccess,
      output: fullOutput,
      summary: this.extractSummary(fullOutput),
      plan,
      error: hasAnyFailure
        ? projectResults
            .filter(r => !r.success)
            .map(r => `${r.projectName}: ${r.error}`)
            .join('; ')
        : undefined,
      durationMs: totalDuration,
      projectResults,
    };
  }

  /**
   * Process a single project.
   */
  private async processProject(
    card: Card,
    role: RoleConfig,
    project: ProjectConfig,
    options?: {
      additionalInstructions?: string;
      cardComments?: string;
      dryRun?: boolean;
    }
  ): Promise<ProjectProcessingResult> {
    const startTime = Date.now();
    let prResult: PRCreationResult | undefined;
    let workingDir = project.path;
    let prManager: PRManager | undefined;
    const taskId = `${card.id}-${project.name}`;

    try {
      // Create PR manager for this project if GitHub is enabled
      if (this.createPRs && this.githubToken && project.github) {
        const githubClient = new GitHubClient({
          token: this.githubToken,
          defaultRepo: project.github,
        });
        const worktreeManager = new WorktreeManager({
          mainRepoPath: project.path,
        });
        prManager = new PRManager({
          githubClient,
          worktreeManager,
          baseBranch: project.baseBranch || 'main',
          branchPrefix: project.branchPrefix || 'feature/',
        });
      }

      // 1. Prepare worktree if PR creation is enabled
      if (prManager) {
        const worktree = await prManager.prepareForTask(card, taskId);
        workingDir = worktree.path;
        log.debug('Worktree created', { path: workingDir, project: project.name });
      }

      // 2. Create task context with project-specific context
      const context = createTaskContext(card, role, {
        projectContext: project.context,
        projectContextFile: project.contextFile,
        cardComments: options?.cardComments,
        additionalInstructions: options?.additionalInstructions,
        projectName: project.name,
        projectPath: project.path,
        interactive: this.interactive,
      });

      // 3. Select model
      const modelSelection = selectModel(role.model as Model, context);
      log.info('Model selected', {
        model: modelSelection.model,
        reason: modelSelection.reason,
        project: project.name,
      });

      // 4. Build prompt
      const prompt = buildPrompt(context);
      log.debug('Prompt built', { promptLength: prompt.length, cardId: card.id, project: project.name });

      // 5. Check for dry run
      if (options?.dryRun || this.dryRun) {
        // Cleanup worktree if created
        if (prManager) {
          await prManager.cleanupTask(taskId);
        }
        return {
          projectName: project.name,
          success: true,
          output: `[DRY RUN] Would execute task "${card.title}" for project "${project.name}" with model ${modelSelection.model}\n\nPrompt length: ${prompt.length} characters\nModel selection: ${modelSelection.reason}${this.createPRs ? '\nWould create PR after completion' : ''}`,
          model: modelSelection.model,
          modelSelection,
          durationMs: Date.now() - startTime,
        };
      }

      // 6. Execute with AI provider (card-specific for interactive mode)
      const provider = this.getProviderForCard(card.id);
      log.info('Executing AI provider', {
        model: modelSelection.model,
        workingDir,
        project: project.name,
        interactive: this.interactive && provider.name === 'claude',
      });
      const result = await provider.execute({
        prompt,
        workingDir,
        model: modelSelection.model,
        timeoutMs: configManager.get<number>('ai.timeoutSeconds', 1800) * 1000,
      });
      log.info('AI execution completed', { success: result.success, durationMs: result.durationMs, project: project.name });

      // 7. Create PR if execution was successful and PR creation is enabled
      if (result.success && prManager) {
        prResult = await prManager.createPRForTask({
          card,
          taskId,
          summary: this.extractSummary(result.output),
        });

        if (prResult.pr) {
          log.info('PR created', { prUrl: prResult.pr.htmlUrl, project: project.name });
        }

        // Cleanup worktree after PR creation
        await prManager.cleanupTask(taskId);
      } else if (prManager) {
        // Cleanup worktree on failure
        await prManager.cleanupTask(taskId);
      }

      return {
        projectName: project.name,
        success: result.success,
        output: result.output,
        error: result.error,
        model: result.model,
        modelSelection,
        durationMs: result.durationMs,
        prUrl: prResult?.pr?.htmlUrl,
        prNumber: prResult?.pr?.number,
      };
    } catch (error) {
      // Cleanup worktree on error
      if (prManager) {
        try {
          await prManager.cleanupTask(taskId);
        } catch {
          // Ignore cleanup errors
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Project processing failed: ${project.name}`, error);

      return {
        projectName: project.name,
        success: false,
        output: '',
        error: errorMessage,
        model: 'unknown',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Extract a structured summary from AI output.
   */
  private extractSummary(output: string): string {
    // Try to extract the structured completion summary
    const structuredMatch = output.match(/\*\*What was done:?\*\*[\s\S]*?^---$/im);
    if (structuredMatch) {
      return structuredMatch[0].trim().slice(0, 2000);
    }

    // Fallback: look for common summary patterns
    const patterns = [
      /summary:?\s*(.+?)(?:\n|$)/i,
      /changes?:?\s*(.+?)(?:\n|$)/i,
      /implemented:?\s*(.+?)(?:\n|$)/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1].trim().slice(0, 200);
      }
    }

    // Return first non-empty line
    const lines = output.split('\n').filter((l) => l.trim());
    return lines[0]?.trim().slice(0, 200) || 'Task completed';
  }

  /**
   * Check if the AI provider is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.baseProvider.isAvailable();
  }

  /**
   * Get provider version.
   */
  async getVersion(): Promise<string | null> {
    return this.baseProvider.getVersion();
  }

  /**
   * Check if interactive mode is enabled and supported.
   */
  isInteractive(): boolean {
    return this.interactive && this.baseProvider.name === 'claude';
  }
}

/**
 * Create a task processor function for the worker.
 *
 * This creates a function compatible with the Worker's TaskProcessor type.
 * Now supports multi-project processing.
 */
export function createTaskProcessorFunction(
  options?: TaskProcessorOptions
): (
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  onProjectComplete?: (result: { projectName: string; success: boolean; error?: string; prUrl?: string; prNumber?: number; output?: string }) => Promise<void> | void,
  cardComments?: string,
  fetchComments?: (cardId: string) => Promise<string | undefined>,
  postComment?: (cardId: string, text: string) => Promise<void>,
) => Promise<{
  success: boolean;
  output: string;
  error?: string;
  projectResults?: ProjectResult[];
}> {
  const processor = new TaskProcessor(options);

  return async (card, role, projects, onProjectComplete, cardComments, fetchComments, postComment) => {
    const result = await processor.processMultiProject(card, role, projects, {
      additionalInstructions: options?.additionalInstructions,
      dryRun: options?.dryRun,
      cardComments,
      fetchComments,
      postComment,
      onProjectComplete: onProjectComplete || options?.onProjectComplete,
    });

    return {
      success: result.success,
      output: result.output,
      summary: result.summary,
      error: result.error,
      projectResults: result.projectResults.map(pr => ({
        projectName: pr.projectName,
        success: pr.success,
        error: pr.error,
        prUrl: pr.prUrl,
        prNumber: pr.prNumber,
      })),
    };
  };
}

/**
 * Create a default task processor.
 */
export function createTaskProcessor(
  options?: TaskProcessorOptions
): TaskProcessor {
  return new TaskProcessor(options);
}
