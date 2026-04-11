/**
 * AI provider types and interfaces.
 *
 * All AI integrations (Claude CLI, Cursor CLI) implement AIProvider.
 */

/**
 * Available AI models.
 */
export type Model = 'haiku' | 'sonnet' | 'opus' | 'auto';

/**
 * Model mapping for Claude CLI.
 */
export const CLAUDE_MODELS: Record<string, string> = {
  haiku: 'claude-3-haiku-20240307',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

/**
 * Result of AI execution.
 */
export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  model: string;
  durationMs: number;
  tokensUsed?: number;
}

/**
 * Options for AI execution.
 */
export interface ExecutionOptions {
  prompt: string;
  workingDir: string;
  model?: Model;
  timeoutMs?: number;
  maxTokens?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
}

/**
 * Context for building prompts.
 */
export interface TaskContext {
  cardId: string;
  cardTitle: string;
  cardDescription: string;
  cardUrl: string;
  labels: string[];
  roleName: string;         // Engineer name
  roleLabel: string;        // Engineer's label
  repoPath: string;         // Current project path
  projectName?: string;     // Current project name
  projectContext?: string;  // Project-specific context
  roleContext?: string;     // Engineer-specific context
  additionalInstructions?: string;
}

/**
 * Abstract AI provider interface.
 *
 * All AI integrations must implement this interface.
 */
export interface AIProvider {
  /**
   * Provider name (claude, cursor).
   */
  readonly name: string;

  /**
   * Check if the AI CLI is available.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a task with the AI.
   */
  execute(options: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Get the version of the AI CLI.
   */
  getVersion(): Promise<string | null>;
}

/**
 * Configuration for AI provider.
 */
export interface AIProviderConfig {
  provider: 'claude' | 'cursor';
  defaultModel: Model;
  timeoutSeconds: number;
  maxRetries?: number;
}
