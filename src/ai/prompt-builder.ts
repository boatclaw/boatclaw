/**
 * Prompt builder for AI tasks.
 *
 * Constructs prompts from card data, role context, and project context.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { TaskContext } from './types.js';
import { Card } from '../platforms/types.js';
import { RoleConfig } from '../core/config.js';

/**
 * Build a prompt for a task.
 */
export function buildPrompt(context: TaskContext): string {
  const sections: string[] = [];

  // System instruction
  sections.push(buildSystemSection());

  // Task section
  sections.push(buildTaskSection(context));

  // Context sections
  if (context.projectContext) {
    sections.push(buildProjectContextSection(context.projectContext));
  }

  if (context.roleContext) {
    sections.push(buildRoleContextSection(context.roleName, context.roleContext));
  }

  // Additional instructions
  if (context.additionalInstructions) {
    sections.push(buildAdditionalInstructionsSection(context.additionalInstructions));
  }

  // Final instruction
  sections.push(buildFinalSection());

  return sections.join('\n\n');
}

/**
 * Build system section.
 */
function buildSystemSection(): string {
  return `You are an AI software engineer assistant. You are given a task from a project management board and must implement it in the codebase.

## Guidelines

1. **Understand the task** - Read the task description carefully and understand what needs to be done.
2. **Explore the codebase** - Look at relevant files to understand the existing code structure and patterns.
3. **Implement the solution** - Write clean, well-structured code that follows existing patterns.
4. **Test your changes** - If tests exist, make sure they pass. Add tests if appropriate.
5. **Keep changes minimal** - Only change what's necessary to complete the task.
6. **Follow conventions** - Match the existing code style and conventions.

## Important Rules

- Do NOT create unnecessary files or add comments unless explicitly requested.
- Do NOT over-engineer. Keep solutions simple and focused.
- Do NOT modify files unrelated to the task.
- If the task is unclear, make reasonable assumptions and document them.
- If you encounter errors, try to fix them before giving up.`;
}

/**
 * Build task section.
 */
function buildTaskSection(context: TaskContext): string {
  let section = `## Task

**Title:** ${context.cardTitle}
**Card URL:** ${context.cardUrl}
**Engineer:** ${context.roleName}`;

  if (context.projectName) {
    section += `\n**Project:** ${context.projectName}`;
  }

  if (context.labels.length > 0) {
    section += `\n**Labels:** ${context.labels.join(', ')}`;
  }

  section += `\n\n### Description\n\n${context.cardDescription || 'No description provided.'}`;

  return section;
}

/**
 * Build project context section.
 */
function buildProjectContextSection(projectContext: string): string {
  return `## Project Context

${projectContext}`;
}

/**
 * Build role context section (engineer's personality/style).
 */
function buildRoleContextSection(roleName: string, roleContext: string): string {
  return `## Engineer Context (${roleName})

${roleContext}`;
}

/**
 * Build additional instructions section.
 */
function buildAdditionalInstructionsSection(instructions: string): string {
  return `## Additional Instructions

${instructions}`;
}

/**
 * Build final section.
 */
function buildFinalSection(): string {
  return `## Your Task

Now implement the task described above. Start by exploring the relevant parts of the codebase, then make the necessary changes.

When you're done, provide a brief summary of what you changed.`;
}

/**
 * Create TaskContext from a Card, RoleConfig (engineer), and project info.
 */
export function createTaskContext(
  card: Card,
  role: RoleConfig,
  options?: {
    projectContextFile?: string;
    additionalInstructions?: string;
    projectName?: string;
    projectPath?: string;
  }
): TaskContext {
  // Determine the base path for context files
  const basePath = options?.projectPath || role.repoPath || process.cwd();

  // Load project context if file exists
  let projectContext: string | undefined;
  if (options?.projectContextFile) {
    const contextPath = resolve(basePath, options.projectContextFile);
    if (existsSync(contextPath)) {
      try {
        projectContext = readFileSync(contextPath, 'utf-8');
      } catch {
        // Ignore read errors
      }
    }
  }

  // Load engineer/role context if file exists
  let roleContext: string | undefined;
  if (role.contextFile) {
    // Role context can be absolute or relative to basePath
    const contextPath = role.contextFile.startsWith('/')
      ? role.contextFile
      : resolve(basePath, role.contextFile);
    if (existsSync(contextPath)) {
      try {
        roleContext = readFileSync(contextPath, 'utf-8');
      } catch {
        // Ignore read errors
      }
    }
  }

  return {
    cardId: card.id,
    cardTitle: card.title,
    cardDescription: card.description,
    cardUrl: card.url,
    labels: card.labels.map((l) => l.name),
    roleName: role.name,
    roleLabel: role.labels?.[0] || role.label || '',
    repoPath: basePath,
    projectName: options?.projectName,
    projectContext,
    roleContext,
    additionalInstructions: options?.additionalInstructions,
  };
}

/**
 * Load context from a file.
 */
export function loadContextFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Estimate token count for a string (rough approximation).
 * Claude uses ~4 characters per token on average.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token limit.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars - 3) + '...';
}
