/**
 * Claude CLI provider implementation.
 *
 * Executes tasks using the Claude CLI (claude command).
 * https://docs.anthropic.com/en/docs/claude-cli
 *
 * Features:
 * - Model selection (haiku, sonnet, opus)
 * - MCP server support for ask_human tool
 * - Interactive mode (when MCP configured)
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AIProvider,
  ExecutionOptions,
  ExecutionResult,
  Model,
  CLAUDE_MODELS,
} from './types.js';

/**
 * MCP server configuration for interactive features.
 */
export interface MCPServerConfig {
  cardId: string;
  boardProvider: 'trello' | 'jira' | 'linear';
  // Board credentials will be read from config
}

/**
 * Claude CLI provider options.
 */
export interface ClaudeProviderOptions {
  defaultModel?: Model;
  timeoutSeconds?: number;
  mcpConfig?: MCPServerConfig;
  interactive?: boolean;
}

/**
 * Claude CLI provider.
 *
 * Supports two modes:
 * - Non-interactive (--print): Fast execution, no human input
 * - Interactive (with MCP): Can ask questions via board comments
 */
export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';
  readonly interactive: boolean;

  private defaultModel: Model;
  private defaultTimeoutMs: number;
  private mcpConfig?: MCPServerConfig;

  constructor(options?: ClaudeProviderOptions) {
    this.defaultModel = options?.defaultModel || 'sonnet';
    this.defaultTimeoutMs = (options?.timeoutSeconds || 1800) * 1000; // 30 min default
    this.mcpConfig = options?.mcpConfig;
    this.interactive = options?.interactive ?? !!options?.mcpConfig;
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
   *
   * Two modes:
   * - Non-interactive (--print): Standard execution, no human input
   * - Interactive (--mcp-config): MCP server for ask_human tool
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
    let mcpConfigPath: string | undefined;
    let args: string[];

    if (this.interactive && this.mcpConfig) {
      // Interactive mode with MCP
      mcpConfigPath = this.createMCPConfig(this.mcpConfig);
      args = this.buildInteractiveArgs(options, modelName, mcpConfigPath);
    } else {
      // Non-interactive mode
      args = this.buildArgs(options, modelName);
    }

    try {
      const result = await this.runClaude(args, options, modelName, timeoutMs, startTime);
      return result;
    } finally {
      // Cleanup MCP config file
      if (mcpConfigPath) {
        this.cleanupMCPConfig(mcpConfigPath);
      }
    }
  }

  /**
   * Run Claude CLI process.
   */
  private runClaude(
    args: string[],
    options: ExecutionOptions,
    modelName: string,
    timeoutMs: number,
    startTime: number
  ): Promise<ExecutionResult> {
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
          // Only set non-interactive for non-MCP mode
          ...(this.interactive ? {} : { CLAUDE_NO_INTERACTIVE: '1' }),
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
   * Build Claude CLI arguments for non-interactive mode.
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

    return args;
  }

  /**
   * Build Claude CLI arguments for interactive mode with MCP.
   */
  private buildInteractiveArgs(
    options: ExecutionOptions,
    modelName: string,
    mcpConfigPath: string
  ): string[] {
    const args: string[] = [
      // Still use print mode but with MCP
      '--print',
      // Model selection
      '--model', modelName,
      // MCP config for ask_human tool
      '--mcp-config', mcpConfigPath,
      // Allow MCP tools without permission prompts
      '--allowedTools', 'mcp__boatclaw-ask-human__ask_human,mcp__boatclaw-ask-human__post_update',
    ];

    // Add max tokens if specified
    if (options.maxTokens) {
      args.push('--max-turns', String(Math.ceil(options.maxTokens / 4000)));
    }

    // Add additional allowed tools if specified
    if (options.allowedTools && options.allowedTools.length > 0) {
      // Append to existing allowed tools
      args[args.indexOf('--allowedTools') + 1] += ',' + options.allowedTools.join(',');
    }

    // Add disallowed tools if specified
    if (options.disallowedTools && options.disallowedTools.length > 0) {
      args.push('--disallowedTools', options.disallowedTools.join(','));
    }

    return args;
  }

  /**
   * Create MCP config file for the ask_human server.
   */
  private createMCPConfig(config: MCPServerConfig): string {
    const configDir = join(tmpdir(), 'boatclaw-mcp');
    mkdirSync(configDir, { recursive: true });

    const configPath = join(configDir, `mcp-config-${Date.now()}.json`);

    // Find the mcp-server.js path relative to this module
    // When installed globally: /usr/local/lib/node_modules/boatclaw/dist/mcp-server.js
    // When installed locally: ./node_modules/boatclaw/dist/mcp-server.js
    // When running from source: ./dist/mcp-server.js
    const mcpServerPath = this.findMCPServerPath();

    // MCP config format for Claude CLI
    const mcpConfig = {
      mcpServers: {
        'boatclaw-ask-human': {
          command: 'node',
          args: [
            mcpServerPath,
            '--card-id', config.cardId,
            '--provider', config.boardProvider,
          ],
        },
      },
    };

    writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
    return configPath;
  }

  /**
   * Find the path to mcp-server.js
   */
  private findMCPServerPath(): string {
    // Get the directory of the current module (claude.js in dist/)
    // import.meta.url gives us file:///path/to/dist/claude.js
    const currentFileUrl = import.meta.url;
    const currentFilePath = new URL(currentFileUrl).pathname;
    const distDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));

    // mcp-server.js should be in the same dist directory
    const mcpServerPath = join(distDir, 'mcp-server.js');

    if (existsSync(mcpServerPath)) {
      return mcpServerPath;
    }

    // Fallback: try relative to cwd (development mode)
    const cwdPath = join(process.cwd(), 'dist', 'mcp-server.js');
    if (existsSync(cwdPath)) {
      return cwdPath;
    }

    // Last resort: assume it's in the PATH or node_modules
    throw new Error(
      'Could not find mcp-server.js. Make sure boatclaw is properly installed.'
    );
  }

  /**
   * Cleanup MCP config file.
   */
  private cleanupMCPConfig(configPath: string): void {
    try {
      unlinkSync(configPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Create a Claude provider instance.
 */
export function createClaudeProvider(options?: ClaudeProviderOptions): ClaudeProvider {
  return new ClaudeProvider(options);
}
