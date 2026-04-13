/**
 * CLI UI utilities - Clean, minimal workflow UI.
 *
 * Design principles:
 * - Clean and structured, not raw logs
 * - Meaningful spacing between sections
 * - Consistent icons (✓ ✗ → ·)
 * - Colors for status (green=success, red=error, cyan=active, dim=secondary)
 * - Easy to scan quickly
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

// ==================== Brand ====================

const BRAND = 'BOATCLAW';
const TAGLINE = 'AI Task Automation';

export function showLogo(): void {
  const innerWidth = 36;

  console.log();
  console.log('  ' + chalk.cyan('┌' + '─'.repeat(innerWidth) + '┐'));
  console.log('  ' + chalk.cyan('│') + ' ' + chalk.cyan.bold('⚓') + ' ' + chalk.bold.white(BRAND) + chalk.dim(' · ' + TAGLINE) + '   ' + chalk.cyan('│'));
  console.log('  ' + chalk.cyan('│') + ' '.repeat(innerWidth) + chalk.cyan('│'));
  console.log('  ' + chalk.cyan('│') + chalk.dim('           ──boatclaw.dev──         ') + chalk.cyan('│'));
  console.log('  ' + chalk.cyan('└' + '─'.repeat(innerWidth) + '┘'));
  console.log();
}

// ==================== Spacing ====================

export function blank(): void {
  console.log();
}

export function spacer(): void {
  console.log();
  console.log();
}

// ==================== Section Headers ====================

/**
 * Main step header for setup wizard.
 * Clean bordered header with cyan accent.
 */
export function header(title: string): void {
  const width = 35;
  const textLen = title.length;
  const padding = Math.max(0, width - textLen);
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;

  console.log();
  console.log('  ' + chalk.cyan('┌' + '─'.repeat(width) + '┐'));
  console.log('  ' + chalk.cyan('│') + ' '.repeat(leftPad) + chalk.bold.white(title) + ' '.repeat(rightPad) + chalk.cyan('│'));
  console.log('  ' + chalk.cyan('└' + '─'.repeat(width) + '┘'));
  console.log();
}

/**
 * Sub-section within a step.
 */
export function section(title: string): void {
  console.log();
  console.log(chalk.bold(title));
  console.log();
}

/**
 * Minimal divider line with cyan accent.
 */
export function divider(): void {
  console.log();
  console.log(chalk.cyan('  ' + '─'.repeat(45)));
  console.log();
}

/**
 * Light separator for grouping.
 */
export function separator(): void {
  console.log();
}

// ==================== Messages ====================

export function success(message: string): void {
  console.log(chalk.green('  ✓') + ' ' + message);
}

export function error(message: string): void {
  console.log(chalk.red('  ✗') + ' ' + message);
}

export function warning(message: string): void {
  console.log(chalk.yellow('  !') + ' ' + message);
}

export function info(message: string): void {
  console.log(chalk.cyan('  →') + ' ' + message);
}

export function dim(message: string): void {
  console.log(chalk.dim('    ' + message));
}

export function hint(message: string): void {
  console.log(chalk.dim('    ' + message));
}

// ==================== Key-Value Display ====================

/**
 * Display key-value pair with alignment.
 * Example:   Platform     Trello
 */
export function keyValue(key: string, value: string): void {
  const keyWidth = 14;
  console.log('  ' + chalk.dim(key.padEnd(keyWidth)) + ' ' + value);
}

/**
 * Display a simple list item.
 */
export function listItem(text: string): void {
  console.log('  ' + chalk.dim('·') + ' ' + text);
}

/**
 * Display numbered item.
 */
export function numberedItem(num: number, text: string): void {
  console.log('  ' + chalk.dim(`${num}.`) + ' ' + text);
}

// ==================== Status Display ====================

/**
 * Status badge with colored indicator.
 */
export function status(label: string, value: string, state: 'success' | 'error' | 'warning' | 'active' | 'dim' = 'dim'): void {
  const colors = {
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    active: chalk.cyan,
    dim: chalk.dim,
  };
  console.log('  ' + label.padEnd(14) + ' ' + colors[state](value));
}

/**
 * Feature enabled/disabled status.
 */
export function featureStatus(name: string, enabled: boolean): void {
  if (enabled) {
    console.log('  ' + name.padEnd(14) + ' ' + chalk.green('✓ Enabled'));
  } else {
    console.log('  ' + name.padEnd(14) + ' ' + chalk.dim('· Disabled'));
  }
}

// ==================== Workflow Visualization ====================

/**
 * Show workflow flow as: Step1 → Step2 → Step3
 */
export function flow(steps: string[]): void {
  const flowStr = steps.join(chalk.dim(' → '));
  console.log('  ' + chalk.cyan(flowStr));
}

/**
 * Show task progress steps.
 */
export function taskProgress(steps: { name: string; status: 'done' | 'active' | 'pending' }[]): void {
  console.log();
  for (const step of steps) {
    let icon: string;
    let color: (s: string) => string;

    switch (step.status) {
      case 'done':
        icon = '✓';
        color = chalk.green;
        break;
      case 'active':
        icon = '→';
        color = chalk.cyan;
        break;
      case 'pending':
        icon = '·';
        color = chalk.dim;
        break;
    }

    console.log('  ' + color(`${icon} ${step.name}`));
  }
  console.log();
}

// ==================== Spinners ====================

export function spinner(text: string): Ora {
  return ora({
    text: '  ' + text,
    color: 'cyan',
    indent: 0,
  });
}

// ==================== Boxes ====================

/**
 * Simple info box for important information.
 */
export function infoBox(lines: string[], options?: { width?: number }): void {
  const width = options?.width ?? 48;
  console.log();
  console.log(chalk.cyan('  ┌' + '─'.repeat(width) + '┐'));
  for (const line of lines) {
    console.log(chalk.cyan('  │') + ' ' + line.padEnd(width - 1) + chalk.cyan('│'));
  }
  console.log(chalk.cyan('  └' + '─'.repeat(width) + '┘'));
  console.log();
}

/**
 * Success completion box.
 */
export function successBox(title: string, lines: string[]): void {
  console.log();
  console.log(chalk.green('  ✓ ' + chalk.bold(title)));
  console.log();
  for (const line of lines) {
    console.log(chalk.dim('    ' + line));
  }
  console.log();
}

// ==================== Progress ====================

export function progressBar(current: number, total: number, width: number = 20): string {
  const percent = Math.min(current / total, 1);
  const filled = Math.round(width * percent);
  const empty = width - filled;
  return chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}

// ==================== Summary Blocks ====================

/**
 * Configuration summary block.
 */
export function configSummary(title: string, items: Record<string, string>): void {
  console.log();
  console.log(chalk.bold('  ' + title));
  console.log();
  for (const [key, value] of Object.entries(items)) {
    keyValue(key, value);
  }
}

/**
 * Next steps block.
 */
export function nextSteps(steps: string[]): void {
  console.log();
  console.log(chalk.bold('  Next Steps'));
  console.log();
  steps.forEach((step, i) => {
    numberedItem(i + 1, step);
  });
  console.log();
}

// ==================== Formatting Helpers ====================

export function formatNumber(num: number): string {
  if (num >= 999999) return 'Unlimited';
  return num.toLocaleString();
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ==================== Colors Export ====================

export const colors = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
};

// ==================== Actions Help ====================

/**
 * Show available actions/commands at the bottom of a list.
 */
export function actions(items: { cmd: string; desc: string }[]): void {
  console.log();
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.bold('  Actions'));
  console.log();
  for (const item of items) {
    console.log('  ' + chalk.cyan(item.cmd.padEnd(32)) + ' ' + chalk.dim(item.desc));
  }
  console.log();
}

// ==================== Legacy Aliases ====================

export const LOGO = '';  // Deprecated, use showLogo()
export function showVersion(version: string): void {
  console.log(chalk.dim(`  v${version}`));
}

export function promptHeader(text: string): void {
  console.log();
  console.log(chalk.bold('  ' + text));
}

export function promptHelp(text: string): void {
  console.log(chalk.dim('  ' + text));
}

export function statusLine(
  label: string,
  value: string,
  state: 'success' | 'warning' | 'error' | 'neutral' = 'neutral'
): void {
  status(label, value, state === 'neutral' ? 'dim' : state);
}

export function box(content: string, title?: string): void {
  const lines = content.split('\n');
  if (title) {
    console.log();
    console.log(chalk.bold('  ' + title));
  }
  infoBox(lines);
}

export function step(message: string): void {
  info(message);
}
