/**
 * AI module exports.
 *
 * Provides AI provider factory and utilities for task execution.
 */

// Types
export {
  Model,
  CLAUDE_MODELS,
  ExecutionResult,
  ExecutionOptions,
  TaskContext,
  AIProvider,
  AIProviderConfig,
} from './types.js';

// Providers
export { ClaudeProvider, createClaudeProvider } from './claude.js';

// Prompt building
export {
  buildPrompt,
  createTaskContext,
  loadContextFile,
  estimateTokens,
  truncateToTokens,
} from './prompt-builder.js';

// Model selection
export {
  Complexity,
  ModelSelection,
  selectModel,
  getModelDescription,
} from './model-selector.js';

// Task processor
export {
  TaskProcessor,
  TaskProcessorOptions,
  TaskProcessingResult,
  createTaskProcessor,
  createTaskProcessorFunction,
} from './task-processor.js';

// Factory
import { AIProvider, AIProviderConfig, Model } from './types.js';
import { createClaudeProvider } from './claude.js';

/**
 * Create an AI provider based on configuration.
 *
 * @param config - Provider configuration
 * @returns AI provider instance
 */
export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case 'claude':
      return createClaudeProvider({
        defaultModel: config.defaultModel,
        timeoutSeconds: config.timeoutSeconds,
      });

    case 'cursor':
      // Cursor support will be added later
      throw new Error('Cursor provider not yet implemented');

    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

/**
 * Get available AI providers.
 */
export function getAvailableProviders(): string[] {
  return ['claude'];
}

/**
 * Get available models for a provider.
 */
export function getAvailableModels(provider: string): Model[] {
  switch (provider) {
    case 'claude':
      return ['auto', 'haiku', 'sonnet', 'opus'];
    case 'cursor':
      return ['auto', 'sonnet', 'opus'];
    default:
      return ['auto', 'sonnet'];
  }
}

/**
 * Check if AI provider is available on the system.
 */
export async function checkAIAvailability(provider: string): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const aiProvider = createAIProvider({
      provider: provider as 'claude' | 'cursor',
      defaultModel: 'sonnet',
      timeoutSeconds: 30,
    });

    const available = await aiProvider.isAvailable();
    if (!available) {
      return {
        available: false,
        error: `${provider} CLI is not installed or not in PATH`,
      };
    }

    const version = await aiProvider.getVersion();
    return {
      available: true,
      version: version || undefined,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
