/**
 * OpenAI Codex CLI provider implementation.
 *
 * Executes tasks using the Codex CLI (`codex exec` command).
 * Install: npm install -g @openai/codex
 * Docs: https://developers.openai.com/codex/cli/reference
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
 * Maps boatclaw's model tiers to OpenAI model names.
 *
 * Available models (use `codex --list-models` to verify):
 * - gpt-5.4 — flagship, coding + reasoning
 * - gpt-5.4-mini — fast, lower cost
 * - gpt-5.3-codex — specialized agentic coding
 * - gpt-5.2 — previous general model
 */
export const CODEX_MODELS: Record<string, string> = {
  haiku: 'gpt-5.4-mini',
  sonnet: 'gpt-5.4',
  opus: 'gpt-5.3-codex',
  auto: 'gpt-5.4',
};

/**
 * Codex CLI provider.
 *
 * Uses `codex exec` for non-interactive headless execution.
 * Runs with --full-auto to auto-approve file writes and commands.
 */
export class CodexProvider implements AIProvider {
  readonly name = 'codex';

  private defaultModel: Model;
  private defaultTimeoutMs: number;

  constructor(options?: { defaultModel?: Model; timeoutSeconds?: number }) {
    this.defaultModel = options?.defaultModel || 'sonnet';
    this.defaultTimeoutMs = (options?.timeoutSeconds || 1800) * 1000;
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
    const modelName = model === 'auto'
      ? CODEX_MODELS['sonnet']
      : CODEX_MODELS[model] || model;

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

      let resolved = false;

      const timeoutId = setTimeout(() => {
        resolved = true;
        proc.kill('SIGTERM');
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
          error: `Failed to spawn codex: ${error.message}. Install: npm install -g @openai/codex`,
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
   * Build Codex CLI arguments.
   */
  private buildArgs(_options: ExecutionOptions, modelName: string): string[] {
    const args: string[] = [
      // Use exec subcommand for non-interactive mode
      'exec',
      // Full auto — auto-approve file writes and commands
      '--full-auto',
      // Model selection
      '--model', modelName,
      // Prompt is sent via stdin (no positional argument needed)
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
