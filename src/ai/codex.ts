/**
 * OpenAI Codex CLI provider implementation.
 *
 * Executes tasks using the OpenAI Codex CLI (codex command).
 * https://github.com/openai/codex
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
 * Model mapping for Codex CLI.
 */
export const CODEX_MODELS: Record<string, string> = {
  // Map our model names to OpenAI models
  haiku: 'gpt-4o-mini',      // Fast, simple tasks
  sonnet: 'gpt-4o',          // Default, balanced
  opus: 'o1',                // Complex reasoning
  auto: 'gpt-4o',            // Default
};

/**
 * Codex CLI provider.
 */
export class CodexProvider implements AIProvider {
  readonly name = 'codex';

  private defaultModel: Model;
  private defaultTimeoutMs: number;

  constructor(options?: { defaultModel?: Model; timeoutSeconds?: number }) {
    this.defaultModel = options?.defaultModel || 'sonnet';
    this.defaultTimeoutMs = (options?.timeoutSeconds || 1800) * 1000; // 30 min default
  }

  /**
   * Check if Codex CLI is available.
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
   * Get Codex CLI version.
   */
  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('codex', ['--version'], {
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
   * Execute a task with Codex CLI.
   */
  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    // Resolve model name
    const modelName = CODEX_MODELS[model] || CODEX_MODELS['sonnet'];

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

      const proc = spawn('codex', args, {
        cwd: options.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
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
          error: `Failed to spawn codex: ${error.message}`,
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
   * Build Codex CLI arguments.
   */
  private buildArgs(options: ExecutionOptions, modelName: string): string[] {
    const args: string[] = [
      // Quiet/non-interactive mode
      '--quiet',
      // Full auto-approval mode
      '--approval-mode', 'full-auto',
      // Model selection
      '--model', modelName,
    ];

    return args;
  }
}

/**
 * Create a Codex provider instance.
 */
export function createCodexProvider(options?: {
  defaultModel?: Model;
  timeoutSeconds?: number;
}): CodexProvider {
  return new CodexProvider(options);
}
