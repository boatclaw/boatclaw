/**
 * Logging system for Boatclaw.
 *
 * Uses pino for structured logging with file output.
 * Logs are stored in ~/.boatclaw/logs/
 */

import pino from 'pino';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, ensureDirs } from './paths.js';

// Log levels
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Current date for log file naming
function getLogFileName(): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `boatclaw-${date}.log`;
}

function getLogFilePath(): string {
  return join(LOG_DIR, getLogFileName());
}

// Ensure log directory exists
ensureDirs();

// Create pino logger with file transport
const transport = pino.transport({
  targets: [
    // File transport - JSON format for parsing
    {
      target: 'pino/file',
      options: {
        destination: getLogFilePath(),
        mkdir: true,
      },
      level: 'debug',
    },
  ],
});

// Create the logger instance
const pinoLogger = pino(
  {
    level: 'debug',
    base: {
      app: 'boatclaw',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport
);

/**
 * Logger wrapper for consistent API.
 */
class Logger {
  private context: string;

  constructor(context: string = 'app') {
    this.context = context;
  }

  /**
   * Create a child logger with context.
   */
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`);
  }

  /**
   * Debug level log.
   */
  debug(message: string, data?: Record<string, unknown>): void {
    pinoLogger.debug({ context: this.context, ...data }, message);
  }

  /**
   * Info level log.
   */
  info(message: string, data?: Record<string, unknown>): void {
    pinoLogger.info({ context: this.context, ...data }, message);
  }

  /**
   * Warning level log.
   */
  warn(message: string, data?: Record<string, unknown>): void {
    pinoLogger.warn({ context: this.context, ...data }, message);
  }

  /**
   * Error level log.
   */
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const errorData: Record<string, unknown> = { context: this.context, ...data };

    if (error instanceof Error) {
      errorData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (error !== undefined) {
      errorData.error = String(error);
    }

    pinoLogger.error(errorData, message);
  }

  /**
   * Log task start.
   */
  taskStart(cardId: string, cardTitle: string, role: string): void {
    this.info('Task started', { cardId, cardTitle, role });
  }

  /**
   * Log task completion.
   */
  taskComplete(cardId: string, cardTitle: string, success: boolean, durationMs: number, prUrl?: string): void {
    this.info('Task completed', { cardId, cardTitle, success, durationMs, prUrl });
  }

  /**
   * Log task error.
   */
  taskError(cardId: string, cardTitle: string, error: Error | string): void {
    this.error('Task failed', error instanceof Error ? error : new Error(String(error)), { cardId, cardTitle });
  }
}

// Singleton logger instance
export const logger = new Logger();

// Create child loggers for different modules
export const workerLogger = logger.child('worker');
export const aiLogger = logger.child('ai');
export const platformLogger = logger.child('platform');
export const githubLogger = logger.child('github');

/**
 * Get list of log files.
 */
export function getLogFiles(): string[] {
  if (!existsSync(LOG_DIR)) {
    return [];
  }

  return readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('boatclaw-') && f.endsWith('.log'))
    .sort()
    .reverse(); // Most recent first
}

/**
 * Read log file contents.
 */
export function readLogFile(filename: string): string {
  const filepath = join(LOG_DIR, filename);
  if (!existsSync(filepath)) {
    throw new Error(`Log file not found: ${filename}`);
  }
  return readFileSync(filepath, 'utf-8');
}

/**
 * Parse log entries from a log file.
 */
export function parseLogEntries(content: string): Array<{
  time: string;
  level: string;
  context: string;
  msg: string;
  data?: Record<string, unknown>;
}> {
  const entries: Array<{
    time: string;
    level: string;
    context: string;
    msg: string;
    data?: Record<string, unknown>;
  }> = [];

  const lines = content.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);
      entries.push({
        time: parsed.time || '',
        level: getLevelName(parsed.level),
        context: parsed.context || 'app',
        msg: parsed.msg || '',
        data: extractData(parsed),
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Convert pino level number to name.
 */
function getLevelName(level: number): string {
  switch (level) {
    case 10: return 'trace';
    case 20: return 'debug';
    case 30: return 'info';
    case 40: return 'warn';
    case 50: return 'error';
    case 60: return 'fatal';
    default: return 'info';
  }
}

/**
 * Extract additional data from log entry.
 */
function extractData(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  const excluded = ['level', 'time', 'pid', 'hostname', 'app', 'context', 'msg'];
  const data: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entry)) {
    if (!excluded.includes(key)) {
      data[key] = value;
    }
  }

  return Object.keys(data).length > 0 ? data : undefined;
}

/**
 * Clear old log files (keep last N days).
 */
export function clearOldLogs(keepDays: number = 7): number {
  const files = getLogFiles();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepDays);

  let deleted = 0;

  for (const file of files) {
    // Extract date from filename: boatclaw-YYYY-MM-DD.log
    const match = file.match(/boatclaw-(\d{4}-\d{2}-\d{2})\.log/);
    if (match) {
      const fileDate = new Date(match[1]);
      if (fileDate < cutoffDate) {
        try {
          unlinkSync(join(LOG_DIR, file));
          deleted++;
        } catch {
          // Ignore deletion errors
        }
      }
    }
  }

  return deleted;
}

/**
 * Get current log file path.
 */
export function getCurrentLogPath(): string {
  return getLogFilePath();
}
