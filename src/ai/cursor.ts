/**
 * Cursor CLI provider implementation.
 *
 * Executes tasks using the Cursor Agent CLI (`agent` command).
 * Install: curl https://cursor.com/install -fsS | bash
 * Docs: https://cursor.com/docs/cli/overview
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
 * Maps boatclaw's model tiers to Cursor's model names.
 * Use `agent --list-models` to see all available models.
 *
 * Cursor supports models from multiple providers:
 * - Anthropic: claude-sonnet-4-5, claude-opus-4-5, claude-haiku-4-5
 * - OpenAI: gpt-5.4, gpt-5.3-codex, gpt-5.2
 * - Google: gemini-3-pro
 * - xAI: grok-code
 */
export const CURSOR_MODELS: Record<string, string> = {
  haiku: 'claude-3-haiku',
  sonnet: 'claude-sonnet-4',
  opus: 'claude-opus-4',
  auto: 'claude-sonnet-4',
};

/**
 * Cursor CLI provider.
 *
 * Uses the `agent` CLI command (installed via cursor.com/install).
 * Runs in headless mode with --print --force for non-interactive execution.
 */
export class CursorProvider implements AIProvider {
  readonly name = 'cursor';

  private defaultModel: Model;
  private defaultTimeoutMs: number;

  constructor(options?: { defaultModel?: Model; timeoutSeconds?: number }) {
    this.defaultModel = options?.defaultModel || 'sonnet';
    this.defaultTimeoutMs = (options?.timeoutSeconds || 1800) * 1000;
  }

  /**
   * Check if Cursor Agent CLI is available.
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
   * Get Cursor Agent CLI version.
   */
  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('agent', ['--version'], {
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
   * Execute a task with Cursor Agent CLI.
   */
  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    // Resolve model name — falls back to raw model string if not in the map
    const modelName = model === 'auto'
      ? CURSOR_MODELS['sonnet']
      : CURSOR_MODELS[model] || model;

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

      const proc = spawn('agent', args, {
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

      let resolved = false;

      const timeoutId = setTimeout(() => {
        resolved = true;
        proc.kill('SIGTERM');
        // SIGKILL after 5s grace period if process doesn't exit
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5000);
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
        if (resolved) return;
        resolved = true;

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
        if (resolved) return;
        resolved = true;

        resolve({
          success: false,
          output: stdout,
          error: `Failed to spawn agent: ${error.message}. Install Cursor CLI: curl https://cursor.com/install -fsS | bash`,
          model: modelName,
          durationMs: Date.now() - startTime,
        });
      });

      // Send prompt via stdin to avoid ARG_MAX limits on long prompts
      proc.stdin?.write(options.prompt);
      proc.stdin?.end();
    });
  }

  /**
   * Build Cursor Agent CLI arguments.
   */
  private buildArgs(_options: ExecutionOptions, modelName: string): string[] {
    const args: string[] = [
      // Non-interactive headless mode
      '--print',
      // Auto-approve file writes and commands
      '--force',
      // Model selection
      '--model', modelName,
      // Prompt is sent via stdin (no positional argument needed)
    ];

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
