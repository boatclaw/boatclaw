/**
 * Claude CLI provider implementation.
 *
 * Executes tasks using the Claude CLI (claude command).
 * https://docs.anthropic.com/en/docs/claude-cli
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import {
  AIProvider,
  ExecutionOptions,
  ExecutionResult,
  Model,
  CLAUDE_MODELS,
} from './types.js';

/**
 * Claude CLI provider.
 */
export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';

  private defaultModel: Model;
  private defaultTimeoutMs: number;

  constructor(options?: { defaultModel?: Model; timeoutSeconds?: number }) {
    this.defaultModel = options?.defaultModel || 'sonnet';
    this.defaultTimeoutMs = (options?.timeoutSeconds || 1800) * 1000; // 30 min default
  }

  /**
   * Check if Claude CLI is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const version = await this.getVersion();
      return version !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get Claude CLI version.
   */
  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && output) {
          // Parse version from output
          const match = output.match(/(\d+\.\d+\.\d+)/);
          resolve(match ? match[1] : output.trim());
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 5000);
    });
  }

  /**
   * Execute a task with Claude CLI.
   */
  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    // Resolve model name
    const modelName = model === 'auto'
      ? CLAUDE_MODELS['sonnet']
      : CLAUDE_MODELS[model] || CLAUDE_MODELS['sonnet'];

    // Build command arguments
    const args = this.buildArgs(options, modelName);

    return new Promise((resolve) => {
      // Verify working directory exists
      if (!existsSync(options.workingDir)) {
        resolve({
          success: false,
          output: '',
          error: `Working directory does not exist: ${options.workingDir}`,
          model: modelName,
          durationMs: Date.now() - startTime,
        });
        return;
      }

      const proc = spawn('claude', args, {
        cwd: options.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure Claude CLI runs in non-interactive mode
          CLAUDE_NO_INTERACTIVE: '1',
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout,
          error: `Execution timed out after ${timeoutMs / 1000}s`,
          model: modelName,
          durationMs: Date.now() - startTime,
        });
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);

        const durationMs = Date.now() - startTime;
        const success = code === 0;

        resolve({
          success,
          output: stdout,
          error: success ? undefined : stderr || `Process exited with code ${code}`,
          model: modelName,
          durationMs,
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);

        resolve({
          success: false,
          output: stdout,
          error: `Failed to spawn claude: ${error.message}`,
          model: modelName,
          durationMs: Date.now() - startTime,
        });
      });

      // Send prompt to stdin and close
      proc.stdin?.write(options.prompt);
      proc.stdin?.end();
    });
  }

  /**
   * Build Claude CLI arguments.
   */
  private buildArgs(options: ExecutionOptions, modelName: string): string[] {
    const args: string[] = [
      // Run in non-interactive/print mode - execute and exit
      '--print',
      // Model selection
      '--model', modelName,
    ];

    // Add max tokens if specified
    if (options.maxTokens) {
      args.push('--max-turns', String(Math.ceil(options.maxTokens / 4000)));
    }

    // Add allowed tools if specified
    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }

    // Add disallowed tools if specified
    if (options.disallowedTools && options.disallowedTools.length > 0) {
      args.push('--disallowedTools', options.disallowedTools.join(','));
    }

    // The prompt will be passed via stdin with --print flag
    // This allows for longer prompts without command line length limits

    return args;
  }
}

/**
 * Create a Claude provider instance.
 */
export function createClaudeProvider(options?: {
  defaultModel?: Model;
  timeoutSeconds?: number;
}): ClaudeProvider {
  return new ClaudeProvider(options);
}
