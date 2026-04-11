/**
 * Model selector for AI tasks.
 *
 * Selects appropriate model based on task complexity when 'auto' is chosen.
 * Uses heuristics based on task content and labels.
 */

import { Model } from './types.js';
import { TaskContext } from './types.js';

/**
 * Complexity levels for tasks.
 */
export type Complexity = 'low' | 'medium' | 'high';

/**
 * Model selection result.
 */
export interface ModelSelection {
  model: Model;
  reason: string;
  complexity: Complexity;
}

/**
 * Labels that indicate high complexity tasks.
 */
const HIGH_COMPLEXITY_LABELS = [
  'architecture',
  'refactor',
  'security',
  'performance',
  'complex',
  'critical',
  'major',
];

/**
 * Labels that indicate low complexity tasks.
 */
const LOW_COMPLEXITY_LABELS = [
  'simple',
  'easy',
  'quick',
  'typo',
  'docs',
  'documentation',
  'minor',
  'chore',
];

/**
 * Keywords in description that indicate high complexity.
 */
const HIGH_COMPLEXITY_KEYWORDS = [
  'refactor',
  'redesign',
  'migrate',
  'architecture',
  'security',
  'authentication',
  'authorization',
  'performance',
  'optimize',
  'database',
  'schema',
  'api design',
  'breaking change',
  'backward compatible',
];

/**
 * Keywords in description that indicate low complexity.
 */
const LOW_COMPLEXITY_KEYWORDS = [
  'typo',
  'fix typo',
  'update text',
  'change text',
  'rename',
  'update comment',
  'add comment',
  'documentation',
  'readme',
  'simple',
  'quick fix',
];

/**
 * Select the best model for a task.
 *
 * When model is 'auto', analyzes the task to determine complexity
 * and selects an appropriate model:
 * - haiku: Low complexity (simple fixes, typos, docs)
 * - sonnet: Medium complexity (most tasks)
 * - opus: High complexity (architecture, refactoring, security)
 *
 * @param requestedModel - The model requested by user/config
 * @param context - Task context for analysis
 * @returns Model selection with reasoning
 */
export function selectModel(
  requestedModel: Model,
  context: TaskContext
): ModelSelection {
  // If specific model requested, use it
  if (requestedModel !== 'auto') {
    return {
      model: requestedModel,
      reason: `User specified ${requestedModel} model`,
      complexity: 'medium', // Unknown when explicitly specified
    };
  }

  // Analyze task complexity
  const complexity = analyzeComplexity(context);

  // Map complexity to model
  const model = complexityToModel(complexity);

  return {
    model,
    reason: getSelectionReason(complexity, context),
    complexity,
  };
}

/**
 * Analyze task complexity based on labels and description.
 */
function analyzeComplexity(context: TaskContext): Complexity {
  const labels = context.labels.map((l) => l.toLowerCase());
  const description = (context.cardDescription || '').toLowerCase();
  const title = context.cardTitle.toLowerCase();
  const combinedText = `${title} ${description}`;

  // Check labels first (most reliable signal)
  for (const label of labels) {
    if (HIGH_COMPLEXITY_LABELS.some((hl) => label.includes(hl))) {
      return 'high';
    }
    if (LOW_COMPLEXITY_LABELS.some((ll) => label.includes(ll))) {
      return 'low';
    }
  }

  // Check keywords in description/title
  for (const keyword of HIGH_COMPLEXITY_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      return 'high';
    }
  }

  for (const keyword of LOW_COMPLEXITY_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      return 'low';
    }
  }

  // Use description length as a secondary signal
  const descLength = context.cardDescription?.length || 0;

  if (descLength < 100) {
    // Very short descriptions are usually simple tasks
    return 'low';
  } else if (descLength > 1000) {
    // Long detailed descriptions usually indicate complex tasks
    return 'high';
  }

  // Default to medium
  return 'medium';
}

/**
 * Map complexity level to model.
 */
function complexityToModel(complexity: Complexity): Model {
  switch (complexity) {
    case 'low':
      return 'haiku';
    case 'medium':
      return 'sonnet';
    case 'high':
      return 'opus';
  }
}

/**
 * Generate human-readable reason for model selection.
 */
function getSelectionReason(complexity: Complexity, context: TaskContext): string {
  const labels = context.labels.map((l) => l.toLowerCase());
  const description = (context.cardDescription || '').toLowerCase();
  const title = context.cardTitle.toLowerCase();
  const combinedText = `${title} ${description}`;

  switch (complexity) {
    case 'high': {
      // Find what triggered high complexity
      for (const label of labels) {
        const match = HIGH_COMPLEXITY_LABELS.find((hl) => label.includes(hl));
        if (match) {
          return `Task labeled "${label}" indicates high complexity`;
        }
      }
      for (const keyword of HIGH_COMPLEXITY_KEYWORDS) {
        if (combinedText.includes(keyword)) {
          return `Task involves "${keyword}" which requires careful analysis`;
        }
      }
      return 'Task description indicates significant complexity';
    }

    case 'low': {
      // Find what triggered low complexity
      for (const label of labels) {
        const match = LOW_COMPLEXITY_LABELS.find((ll) => label.includes(ll));
        if (match) {
          return `Task labeled "${label}" indicates simple change`;
        }
      }
      for (const keyword of LOW_COMPLEXITY_KEYWORDS) {
        if (combinedText.includes(keyword)) {
          return `Task is a "${keyword}" - straightforward change`;
        }
      }
      return 'Task description indicates a simple change';
    }

    case 'medium':
    default:
      return 'Standard task complexity - using default model';
  }
}

/**
 * Get model description for display.
 */
export function getModelDescription(model: Model): string {
  switch (model) {
    case 'haiku':
      return 'Claude 3 Haiku - Fast, efficient for simple tasks';
    case 'sonnet':
      return 'Claude Sonnet 4 - Balanced performance and capability';
    case 'opus':
      return 'Claude Opus 4 - Most capable for complex tasks';
    case 'auto':
      return 'Auto - Selects model based on task complexity';
  }
}
