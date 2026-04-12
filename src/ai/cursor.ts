/**
 * Cursor CLI provider implementation.
 *
 * Executes tasks using the Cursor CLI (cursor command).
 * https://docs.cursor.com/cli
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import {
  AIProvider,
  ExecutionOptions,
  ExecutionResult,
  Model,
} from './types.js';

/**
 * Model mapping for Cursor CLI.
 */
export const CURSOR_MODELS: Record<string, string> = {
  sonnet: 'claude-3-5-sonnet',
  opus: 'claude-3-opus',
  // Cursor also supports GPT models
  gpt4: 'gpt-4',
  gpt4turbo: 'gpt-4-turbo',
};

/**
 * Cursor CLI provider.
 */
export class CursorProvider implements AIProvider {
  readonly name = 'cursor';

  private defaultModel: Model;
  private defaultTimeoutMs: number;

  constructor(options?: { defaultModel?: Model; timeoutSeconds?: number }) {
    this.defaultModel = options?.defaultModel || 'sonnet';
    this.defaultTimeoutMs = (options?.timeoutSeconds || 1800) * 1000; // 30 min default
  }

  /**
   * Check if Cursor CLI is available.
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
   * Get Cursor CLI version.
   */
  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('cursor', ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && output) {
          const match = output.match(/(\d+\.\d+\.\d+)/);
          resolve(match ? match[1] : output.trim());
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });

      setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 5000);
    });
  }

  /**
   * Execute a task with Cursor CLI.
   */
  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    // Resolve model name
    const modelName = model === 'auto'
      ? CURSOR_MODELS['sonnet']
      : CURSOR_MODELS[model] || CURSOR_MODELS['sonnet'];

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

      const proc = spawn('cursor', args, {
        cwd: options.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure non-interactive mode
          CURSOR_NO_INTERACTIVE: '1',
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
          error: `Failed to spawn cursor: ${error.message}`,
          model: modelName,
          durationMs: Date.now() - startTime,
        });
      });

      // Send prompt to stdin
      proc.stdin?.write(options.prompt);
      proc.stdin?.end();
    });
  }

  /**
   * Build Cursor CLI arguments.
   */
  private buildArgs(options: ExecutionOptions, modelName: string): string[] {
    const args: string[] = [
      // Run in agent mode
      'agent',
      // Model selection
      '--model', modelName,
    ];

    // Add max tokens if specified
    if (options.maxTokens) {
      args.push('--max-tokens', String(options.maxTokens));
    }

    return args;
  }
}

/**
 * Create a Cursor provider instance.
 */
export function createCursorProvider(options?: {
  defaultModel?: Model;
  timeoutSeconds?: number;
}): CursorProvider {
  return new CursorProvider(options);
}
