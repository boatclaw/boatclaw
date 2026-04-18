/**
 * Log viewing commands.
 *
 * Commands:
 * - logs: View recent logs (default: today)
 * - logs list: List all log files
 * - logs show <file>: Show specific log file
 * - logs tail: Follow logs in real-time
 * - logs clear: Clear old log files
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { watchFile, unwatchFile, statSync, openSync, readSync, closeSync } from 'fs';
import {
  getLogFiles,
  readLogFile,
  parseLogEntries,
  clearOldLogs,
  getCurrentLogPath,
} from '../../core/logger.js';
import { LOG_DIR } from '../../core/paths.js';
import * as ui from '../ui.js';

export function registerLogsCommands(program: Command): void {
  const logs = program
    .command('logs')
    .description('View application logs');

  // Default: show today's logs
  logs
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-l, --level <level>', 'Filter by log level (debug, info, warn, error)')
    .option('--json', 'Output raw JSON format')
    .action((options: { lines?: string; level?: string; json?: boolean }) => {
      showLogs(options);
    });

  // List log files
  logs
    .command('list')
    .description('List all log files')
    .action(() => {
      listLogFiles();
    });

  // Show specific log file
  logs
    .command('show <file>')
    .description('Show contents of a specific log file')
    .option('-n, --lines <number>', 'Number of lines to show')
    .option('--json', 'Output raw JSON format')
    .action((file: string, options: { lines?: string; json?: boolean }) => {
      showLogFile(file, options);
    });

  // Tail logs (follow)
  logs
    .command('tail')
    .description('Follow logs in real-time')
    .option('-l, --level <level>', 'Filter by log level')
    .action((options: { level?: string }) => {
      tailLogs(options);
    });

  // Clear old logs
  logs
    .command('clear')
    .description('Clear old log files')
    .option('-d, --days <number>', 'Keep logs from last N days', '7')
    .action((options: { days?: string }) => {
      clearLogs(options);
    });

  // Show log directory path
  logs
    .command('path')
    .description('Show log directory path')
    .action(() => {
      console.log(LOG_DIR);
    });
}

function showLogs(options: { lines?: string; level?: string; json?: boolean }): void {
  const files = getLogFiles();

  if (files.length === 0) {
    ui.info('No log files found.');
    ui.dim(`Logs will be created when you run ${chalk.cyan('boatclaw start')}`);
    return;
  }

  // Read most recent log file
  const latestFile = files[0];

  try {
    const content = readLogFile(latestFile);
    displayLogContent(content, options);
  } catch (error) {
    ui.error(`Failed to read log file: ${error instanceof Error ? error.message : String(error)}`);
  }

  ui.actions([
    { cmd: 'boatclaw logs list', desc: 'List all log files' },
    { cmd: 'boatclaw logs show <file>', desc: 'View a specific log file' },
    { cmd: 'boatclaw logs tail', desc: 'Watch live logs' },
    { cmd: 'boatclaw logs clear', desc: 'Delete old logs' },
  ]);
}

function listLogFiles(): void {
  const files = getLogFiles();

  if (files.length === 0) {
    ui.info('No log files found.');
    return;
  }

  console.log();
  console.log(chalk.bold('Log Files'));
  console.log(chalk.dim(`Directory: ${LOG_DIR}`));
  console.log();

  for (const file of files) {
    // Extract date from filename
    const match = file.match(/boatclaw-(\d{4}-\d{2}-\d{2})\.log/);
    const date = match ? match[1] : 'unknown';

    const isToday = date === new Date().toISOString().split('T')[0];
    const label = isToday ? chalk.green(' (today)') : '';

    console.log(`  ${chalk.cyan(file)}${label}`);
  }

  console.log();
  ui.dim(`View logs with: ${chalk.cyan('boatclaw logs show <file>')}`);
  console.log();
}

function showLogFile(file: string, options: { lines?: string; json?: boolean }): void {
  try {
    // Add .log extension if not present
    const filename = file.endsWith('.log') ? file : `${file}.log`;

    const content = readLogFile(filename);
    displayLogContent(content, options);
  } catch (error) {
    ui.error(`Failed to read log file: ${error instanceof Error ? error.message : String(error)}`);

    // Show available files
    const files = getLogFiles();
    if (files.length > 0) {
      console.log();
      ui.info('Available log files:');
      for (const f of files.slice(0, 5)) {
        console.log(`  ${chalk.cyan(f)}`);
      }
    }
  }
}

function displayLogContent(content: string, options: { lines?: string; level?: string; json?: boolean }): void {
  const maxLines = parseInt(options.lines || '50', 10);

  if (options.json) {
    // Raw JSON output
    const lines = content.trim().split('\n').slice(-maxLines);
    console.log(lines.join('\n'));
    return;
  }

  // Parse and format entries
  const entries = parseLogEntries(content);

  // Filter by level if specified
  let filtered = entries;
  if (options.level) {
    const levelFilter = options.level.toLowerCase();
    filtered = entries.filter((e) => e.level === levelFilter);
  }

  // Take last N entries
  const display = filtered.slice(-maxLines);

  if (display.length === 0) {
    ui.info('No log entries found matching criteria.');
    return;
  }

  console.log();

  for (const entry of display) {
    const time = formatTime(entry.time);
    const level = formatLevel(entry.level);
    const context = chalk.dim(`[${entry.context}]`);
    const message = entry.msg;

    console.log(`${time} ${level} ${context} ${message}`);

    // Show additional data if present
    if (entry.data && Object.keys(entry.data).length > 0) {
      for (const [key, value] of Object.entries(entry.data)) {
        if (key === 'error' && typeof value === 'object' && value !== null) {
          const err = value as { message?: string; stack?: string };
          console.log(chalk.dim(`    error: ${err.message}`));
          if (err.stack) {
            const stackLines = err.stack.split('\n').slice(1, 4);
            for (const line of stackLines) {
              console.log(chalk.dim(`    ${line.trim()}`));
            }
          }
        } else {
          console.log(chalk.dim(`    ${key}: ${JSON.stringify(value)}`));
        }
      }
    }
  }

  console.log();
  ui.dim(`Showing last ${display.length} entries`);
  console.log();
}

function formatTime(isoTime: string): string {
  try {
    const date = new Date(isoTime);
    return chalk.dim(date.toLocaleTimeString('en-US', { hour12: false }));
  } catch {
    return chalk.dim(isoTime);
  }
}

function formatLevel(level: string): string {
  switch (level) {
    case 'debug':
      return chalk.gray('DBG');
    case 'info':
      return chalk.blue('INF');
    case 'warn':
      return chalk.yellow('WRN');
    case 'error':
      return chalk.red('ERR');
    case 'fatal':
      return chalk.bgRed.white('FTL');
    default:
      return chalk.gray(level.toUpperCase().slice(0, 3));
  }
}

function tailLogs(options: { level?: string }): void {
  const logPath = getCurrentLogPath();

  console.log();
  console.log(chalk.bold('Following logs...'));
  console.log(chalk.dim(`File: ${logPath}`));
  console.log(chalk.dim('Press Ctrl+C to stop'));
  console.log();

  // Cross-platform log following using fs.watchFile (works on Windows, macOS, Linux)
  let lastSize = 0;
  try {
    lastSize = statSync(logPath).size;
  } catch {
    // File may not exist yet
  }

  const processNewLines = (data: string) => {
    const lines = data.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);
        const level = getLevelNameFromNumber(entry.level);

        // Filter by level if specified
        if (options.level && level !== options.level.toLowerCase()) {
          continue;
        }

        const time = formatTime(entry.time);
        const levelStr = formatLevel(level);
        const context = chalk.dim(`[${entry.context || 'app'}]`);
        const message = entry.msg || '';

        console.log(`${time} ${levelStr} ${context} ${message}`);
      } catch {
        // Output raw line if not JSON
        console.log(line);
      }
    }
  };

  watchFile(logPath, { interval: 500 }, (curr) => {
    if (curr.size < lastSize) {
      // File was rotated/truncated — reset to read from beginning
      lastSize = 0;
    }
    if (curr.size > lastSize) {
      let fd: number | undefined;
      try {
        // Read only new content
        fd = openSync(logPath, 'r');
        const buffer = Buffer.alloc(curr.size - lastSize);
        readSync(fd, buffer, 0, buffer.length, lastSize);
        processNewLines(buffer.toString('utf-8'));
      } catch {
        // Ignore read errors
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
      lastSize = curr.size;
    }
  });

  // Handle cleanup on exit
  process.on('SIGINT', () => {
    unwatchFile(logPath);
    console.log();
    process.exit(0);
  });
}

function getLevelNameFromNumber(level: number): string {
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

function clearLogs(options: { days?: string }): void {
  const keepDays = parseInt(options.days || '7', 10);

  const deleted = clearOldLogs(keepDays);

  if (deleted > 0) {
    ui.success(`Deleted ${deleted} old log file(s).`);
  } else {
    ui.info(`No log files older than ${keepDays} days found.`);
  }
}
