/**
 * Task Planner — decides which projects need changes before execution.
 *
 * For multi-project agents, runs a quick planning step that:
 * 1. Reads the ticket + all project contexts
 * 2. Decides which projects need changes
 * 3. Determines execution order (e.g., backend API first, then frontend)
 * 4. Identifies shared contracts/schemas
 *
 * Uses a fast model (haiku) since it's analysis, not coding.
 */

import { Card } from '../platforms/types.js';
import { RoleConfig, ProjectConfig } from '../core/config.js';
import { AIProvider } from './types.js';
import { aiLogger as log } from '../core/logger.js';

/**
 * Planning result for a multi-project task.
 */
export interface TaskPlan {
  /** Which projects need changes, in execution order */
  projects: string[];
  /** Overall scope classification */
  scope: 'single-project' | 'cross-project';
  /** Brief reasoning for the plan */
  reasoning: string;
  /** Whether shared contracts/APIs/schemas are involved */
  sharedContracts: boolean;
  /** Notes for the execution phase */
  executionNotes?: string;
}

/**
 * Build the planning prompt.
 */
function buildPlanningPrompt(
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  cardComments?: string,
): string {
  const projectDescriptions = projects.map(p => {
    let desc = `- **${p.name}** (path: ${p.path})`;
    if (p.context) {
      desc += `\n  Context: ${p.context.slice(0, 500)}`;
    }
    if (p.github) {
      desc += `\n  GitHub: ${p.github}`;
    }
    return desc;
  }).join('\n');

  let prompt = `You are a technical project planner. Analyze this task and decide which projects need changes.

## Task
**Title:** ${card.title}
**Description:** ${card.description || 'No description provided.'}`;

  if (card.labels.length > 0) {
    prompt += `\n**Labels:** ${card.labels.map(l => l.name).join(', ')}`;
  }

  if (cardComments) {
    prompt += `\n\n## Ticket Comments\n${cardComments}`;
  }

  prompt += `

## Available Projects
${projectDescriptions}

## Instructions

Analyze the task and determine:
1. Which of the above projects need code changes for this task?
2. In what order should they be executed? (e.g., backend API first, then frontend that uses it)
3. Are there shared contracts, APIs, or schemas that multiple projects will need to agree on?

Respond in EXACTLY this format — no other text:

PROJECTS: project1, project2
ORDER: project1, project2
SCOPE: single-project | cross-project
SHARED_CONTRACTS: yes | no
REASONING: One sentence explaining your decision
EXECUTION_NOTES: Any important notes for the developer (or "None")

Rules:
- Only include projects that ACTUALLY need code changes
- If the task is clearly about one project only (e.g., a backend bug), only list that project
- If unsure whether a project needs changes, include it
- Order matters: if project B depends on changes in project A, list A first`;

  return prompt;
}

/**
 * Parse the planning response.
 */
function parsePlanningResponse(output: string, availableProjects: ProjectConfig[]): TaskPlan | null {
  const availableNames = availableProjects.map(p => p.name.toLowerCase());

  // Parse PROJECTS (anchored to line start to avoid matching echoed instructions)
  const projectsMatch = output.match(/^PROJECTS:\s*(.+)/im);
  if (!projectsMatch) return null;

  const requestedProjects = projectsMatch[1]
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p && availableNames.includes(p));

  if (requestedProjects.length === 0) return null;

  // Parse ORDER (use PROJECTS order as fallback)
  const orderMatch = output.match(/^ORDER:\s*(.+)/im);
  const orderedProjects = orderMatch
    ? orderMatch[1].split(',').map(p => p.trim().toLowerCase()).filter(p => requestedProjects.includes(p))
    : requestedProjects;

  // Ensure all requested projects are in the ordered list
  const finalOrder = [
    ...orderedProjects,
    ...requestedProjects.filter(p => !orderedProjects.includes(p)),
  ];

  // Map back to original project names (preserve case)
  const projectNames = finalOrder.map(p => {
    const original = availableProjects.find(ap => ap.name.toLowerCase() === p);
    return original?.name || p;
  });

  // Parse SCOPE
  const scopeMatch = output.match(/^SCOPE:\s*(single-project|cross-project)/im);
  const scope = scopeMatch?.[1]?.toLowerCase() === 'cross-project' ? 'cross-project' : 'single-project';

  // Parse SHARED_CONTRACTS
  const contractsMatch = output.match(/^SHARED_CONTRACTS:\s*(yes|no)/im);
  const sharedContracts = contractsMatch?.[1]?.toLowerCase() === 'yes';

  // Parse REASONING
  const reasoningMatch = output.match(/^REASONING:\s*(.+)/im);
  const reasoning = reasoningMatch?.[1]?.trim() || 'No reasoning provided';

  // Parse EXECUTION_NOTES
  const notesMatch = output.match(/^EXECUTION_NOTES:\s*(.+)/im);
  const executionNotes = notesMatch?.[1]?.trim();

  return {
    projects: projectNames,
    scope,
    reasoning,
    sharedContracts,
    executionNotes: executionNotes === 'None' ? undefined : executionNotes,
  };
}

/**
 * Run the planning phase for a multi-project task.
 *
 * Returns a TaskPlan that tells the processor which projects to run and in what order.
 * Uses haiku (fast/cheap) for the planning step.
 * Falls back to all projects if planning fails.
 */
export async function planTask(
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  aiProvider: AIProvider,
  cardComments?: string,
  plannerModel?: string,
): Promise<TaskPlan> {
  // Skip planning for single-project agents
  if (projects.length <= 1) {
    return {
      projects: projects.map(p => p.name),
      scope: 'single-project',
      reasoning: 'Single project — no planning needed',
      sharedContracts: false,
    };
  }

  try {
    log.info('Starting planning phase', {
      cardId: card.id,
      projects: projects.map(p => p.name).join(', '),
    });

    const prompt = buildPlanningPrompt(card, role, projects, cardComments);

    const result = await aiProvider.execute({
      prompt,
      workingDir: projects[0].path,
      model: (plannerModel || 'haiku') as 'haiku' | 'sonnet' | 'opus',
      timeoutMs: 60000,
    });

    if (!result.success) {
      log.warn('Planning phase failed, using all projects', { error: result.error });
      return fallbackPlan(projects);
    }

    const plan = parsePlanningResponse(result.output, projects);

    if (!plan) {
      log.warn('Could not parse planning response, using all projects');
      return fallbackPlan(projects);
    }

    log.info('Planning phase complete', {
      cardId: card.id,
      scope: plan.scope,
      projects: plan.projects.join(', '),
      reasoning: plan.reasoning,
      sharedContracts: plan.sharedContracts,
    });

    return plan;
  } catch (error) {
    log.warn('Planning phase error, using all projects', {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackPlan(projects);
  }
}

/**
 * Fallback plan when planning fails — run all projects.
 */
function fallbackPlan(projects: ProjectConfig[]): TaskPlan {
  return {
    projects: projects.map(p => p.name),
    scope: 'cross-project',
    reasoning: 'Planning unavailable — running all projects',
    sharedContracts: false,
  };
}
