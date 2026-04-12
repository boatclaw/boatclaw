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
export {
  ClaudeProvider,
  createClaudeProvider,
  type ClaudeProviderOptions,
  type MCPServerConfig,
} from './claude.js';
export { CursorProvider, createCursorProvider } from './cursor.js';
export { CodexProvider, createCodexProvider } from './codex.js';

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
import { createClaudeProvider, MCPServerConfig } from './claude.js';
import { createCursorProvider } from './cursor.js';
import { createCodexProvider } from './codex.js';

/**
 * Extended provider config with interactive support.
 */
export interface AIProviderConfigWithInteractive extends AIProviderConfig {
  interactive?: boolean;
  mcpConfig?: MCPServerConfig;
}

/**
 * Create an AI provider based on configuration.
 *
 * @param config - Provider configuration
 * @returns AI provider instance
 */
export function createAIProvider(config: AIProviderConfigWithInteractive): AIProvider {
  switch (config.provider) {
    case 'claude':
      return createClaudeProvider({
        defaultModel: config.defaultModel,
        timeoutSeconds: config.timeoutSeconds,
        interactive: config.interactive,
        mcpConfig: config.mcpConfig,
      });

    case 'cursor':
      return createCursorProvider({
        defaultModel: config.defaultModel,
        timeoutSeconds: config.timeoutSeconds,
      });

    case 'codex':
      return createCodexProvider({
        defaultModel: config.defaultModel,
        timeoutSeconds: config.timeoutSeconds,
      });

    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

/**
 * Get available AI providers.
 */
export function getAvailableProviders(): string[] {
  return ['claude', 'cursor', 'codex'];
}

/**
 * Check if a provider supports interactive mode (ask_human).
 * Currently only Claude Code supports this via MCP.
 */
export function supportsInteractiveMode(provider: string): boolean {
  return provider === 'claude';
}

/**
 * Get provider info including interactive capability.
 */
export function getProviderInfo(provider: string): {
  name: string;
  displayName: string;
  interactive: boolean;
  description: string;
} {
  switch (provider) {
    case 'claude':
      return {
        name: 'claude',
        displayName: 'Claude Code',
        interactive: true,
        description: 'Anthropic Claude CLI - supports interactive mode (can ask questions)',
      };
    case 'cursor':
      return {
        name: 'cursor',
        displayName: 'Cursor',
        interactive: false,
        description: 'Cursor AI CLI - non-interactive mode only',
      };
    case 'codex':
      return {
        name: 'codex',
        displayName: 'Codex',
        interactive: false,
        description: 'OpenAI Codex CLI - non-interactive mode only',
      };
    default:
      return {
        name: provider,
        displayName: provider,
        interactive: false,
        description: 'Unknown provider',
      };
  }
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
    case 'codex':
      return ['auto', 'haiku', 'sonnet', 'opus'];
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
