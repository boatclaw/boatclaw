/**
 * Custom prompts and UX helpers for better terminal experience.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import * as readline from 'readline';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname, parse, join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

/**
 * Find the git executable path.
 * On Windows, git may not be in PATH even if installed.
 * Checks common install locations as fallback.
 */
let gitPath: string | null = null;
let gitChecked = false;

function findGit(): string {
  if (gitChecked && gitPath) return gitPath;
  gitChecked = true;

  // First try: just 'git' (works if it's in PATH)
  try {
    execSync('git --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    gitPath = 'git';
    return gitPath;
  } catch {
    // Not in PATH
  }

  // Windows fallback: check common install locations
  if (process.platform === 'win32') {
    const commonPaths = [
      join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe'),
      join(process.env['LOCALAPPDATA'] || '', 'Programs', 'Git', 'cmd', 'git.exe'),
    ];
    for (const p of commonPaths) {
      if (existsSync(p)) {
        gitPath = `"${p}"`;
        return gitPath;
      }
    }
  }

  // Not found anywhere
  gitPath = 'git'; // Will fail but let the caller handle it
  return gitPath;
}

/**
 * Path selection with easy navigation.
 * Starts from current directory, user can:
 * - Select current directory
 * - Navigate up (..)
 * - Navigate into subdirectories
 * - Type path directly
 */
export async function selectPath(options: {
  message: string;
  startPath?: string;
  onlyDirectories?: boolean;
}): Promise<string> {
  let currentPath = options.startPath || process.cwd();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const entries = getDirectoryEntries(currentPath, options.onlyDirectories ?? true);

    const rootPath = parse(currentPath).root; // '/' on Unix, 'C:\' on Windows
    const isAtRoot = currentPath === rootPath;

    const choices = [
      { name: chalk.green(`✓ Use this folder: ${currentPath}`), value: '__SELECT__' },
      ...(!isAtRoot ? [{ name: chalk.dim('..  (go up)'), value: '__UP__' }] : []),
      { name: chalk.cyan('🏠 Go to home folder'), value: '__HOME__' },
      { name: chalk.cyan('💿 Go to drive/root'), value: '__ROOT__' },
      { name: chalk.cyan('📝 Type path manually'), value: '__MANUAL__' },
      new inquirer.Separator(),
      ...entries.map((entry) => ({
        name: entry.isDirectory ? chalk.blue(`📁 ${entry.name}/`) : entry.name,
        value: entry.path,
      })),
    ];

    const { selection } = await inquirer.prompt([{
      type: 'list',
      name: 'selection',
      message: options.message,
      choices,
      pageSize: 15,
    }]);

    if (selection === '__SELECT__') {
      return currentPath;
    }

    if (selection === '__UP__') {
      currentPath = dirname(currentPath);
      continue;
    }

    if (selection === '__HOME__') {
      currentPath = homedir();
      continue;
    }

    if (selection === '__ROOT__') {
      if (process.platform === 'win32') {
        // On Windows, let user type drive letter (D:\, E:\, etc.)
        const { drive } = await inquirer.prompt([{
          type: 'input',
          name: 'drive',
          message: 'Enter drive (e.g. C, D, E):',
          default: parse(currentPath).root.charAt(0),
          filter: (val: string) => `${val.toUpperCase()}:\\`,
          validate: (val: string) => {
            // val is already filtered (e.g. "C:\") — use directly
            return existsSync(val) || `Drive ${val} not found`;
          },
        }]);
        currentPath = drive;
      } else {
        currentPath = '/';
      }
      continue;
    }

    if (selection === '__MANUAL__') {
      const { manualPath } = await inquirer.prompt([{
        type: 'input',
        name: 'manualPath',
        message: 'Enter path:',
        default: currentPath,
        validate: (value: string) => {
          const resolved = resolve(value);
          if (!existsSync(resolved)) {
            return `Path does not exist: ${resolved}`;
          }
          return true;
        },
      }]);
      return resolve(manualPath);
    }

    // Navigate into selected directory
    if (statSync(selection).isDirectory()) {
      currentPath = selection;
    } else {
      return selection;
    }
  }
}

/**
 * Get directory entries for navigation.
 */
function getDirectoryEntries(dirPath: string, onlyDirectories: boolean): Array<{
  name: string;
  path: string;
  isDirectory: boolean;
}> {
  try {
    const entries = readdirSync(dirPath);
    return entries
      .filter((name) => !name.startsWith('.')) // Hide hidden files
      .map((name) => {
        const fullPath = resolve(dirPath, name);
        const isDir = statSync(fullPath).isDirectory();
        return { name, path: fullPath, isDirectory: isDir };
      })
      .filter((entry) => !onlyDirectories || entry.isDirectory)
      .sort((a, b) => {
        // Directories first
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20); // Limit to prevent long lists
  } catch {
    return [];
  }
}

/**
 * Multi-line text input for context.
 * Simple inline input - type text and press Enter twice to finish.
 */
export async function inputMultilineText(options: {
  message: string;
  hint?: string;
  defaultValue?: string;
}): Promise<string> {
  console.log();
  console.log(chalk.bold(options.message));
  if (options.hint) {
    console.log(chalk.dim(options.hint));
  }
  console.log();
  console.log(chalk.dim('Type your text below. Press Enter twice when done.'));
  console.log(chalk.dim('─'.repeat(45)));

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const lines: string[] = [];
    let emptyLineCount = 0;

    const promptLine = () => {
      rl.question('', (line: string) => {
        if (line === '') {
          emptyLineCount++;
          if (emptyLineCount >= 2) {
            // Two empty lines = done
            rl.close();
            const result = lines.join('\n').trim();
            console.log(chalk.dim('─'.repeat(45)));
            if (result) {
              console.log(chalk.green('  ✓') + ' Context saved');
            } else {
              console.log(chalk.dim('  No content entered'));
            }
            resolve(result);
            return;
          }
          lines.push('');
        } else {
          emptyLineCount = 0;
          lines.push(line);
        }
        promptLine();
      });
    };

    promptLine();
  });
}

/**
 * Detect GitHub remote from a git repository.
 */
export function detectGitHubRepo(repoPath: string): string | null {
  // Try to find the remote URL from multiple sources
  let remoteUrl: string | null = null;

  // Method 1: Read .git/config directly (no git CLI needed, works everywhere)
  try {
    // .git can be a directory (normal) or a file (worktree/submodule)
    const gitPath = join(repoPath, '.git');
    let configPath = join(gitPath, 'config');

    // If .git is a file, read the real git dir from it
    if (existsSync(gitPath) && statSync(gitPath).isFile()) {
      const gitFileContent = readFileSync(gitPath, 'utf-8').trim();
      // Format: "gitdir: /path/to/real/.git/worktrees/name"
      const gitdirMatch = gitFileContent.match(/gitdir:\s*(.+)/);
      if (gitdirMatch) {
        // The config is in the parent of the worktree dir
        const realGitDir = resolve(repoPath, gitdirMatch[1].trim());
        // Go up from worktrees/name to the main .git dir
        const mainGitDir = resolve(realGitDir, '..', '..');
        configPath = join(mainGitDir, 'config');
      }
    }

    if (existsSync(configPath)) {
      const config = readFileSync(configPath, 'utf-8');
      // Look for [remote "origin"] section and extract url
      // Handles both double and single quotes, and Windows \r\n line endings
      const originMatch = config.match(/\[remote\s+["']origin["']\][^[]*?url\s*=\s*(.+)/m);
      if (originMatch) {
        remoteUrl = originMatch[1].trim().replace(/\r$/, '');
      }
    }
  } catch {
    // Ignore read errors
  }

  // Method 2: Try git CLI as fallback
  if (!remoteUrl) {
    try {
      const git = findGit();
      remoteUrl = execSync(`${git} remote get-url origin`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Git CLI not available or not a git repo
    }
  }

  if (!remoteUrl) return null;

  // Parse GitHub URL
  // Formats:
  // - https://github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  // - https://github.com/owner/repo
  const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }

  return null;
}

/**
 * Check if a path is a git repository.
 */
export function isGitRepo(repoPath: string): boolean {
  // Primary: check for .git directory or file (works without git CLI)
  const gitDir = join(repoPath, '.git');
  if (existsSync(gitDir)) {
    return true;
  }

  // Fallback: try git CLI (handles worktrees and other edge cases)
  try {
    const git = findGit();
    execSync(`${git} rev-parse --git-dir`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default branch of a git repository.
 */
export function getDefaultBranch(repoPath: string): string {
  const git = findGit();
  try {
    // Try to get the default branch from remote
    const result = execSync(`${git} symbolic-ref refs/remotes/origin/HEAD`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Format: refs/remotes/origin/main
    const match = result.match(/refs\/remotes\/origin\/(.+)$/);
    if (match) {
      return match[1];
    }
  } catch {
    // Fallback: check if main or master exists
    try {
      execSync(`${git} show-ref --verify refs/heads/main`, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return 'main';
    } catch {
      try {
        execSync(`${git} show-ref --verify refs/heads/master`, {
          cwd: repoPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return 'master';
      } catch {
        // Default
      }
    }
  }

  return 'main';
}

/**
 * Quick yes/no confirmation.
 */
export async function confirm(message: string, defaultValue = true): Promise<boolean> {
  const { result } = await inquirer.prompt([{
    type: 'confirm',
    name: 'result',
    message,
    default: defaultValue,
  }]);
  return result;
}

/**
 * Simple text input.
 */
export async function input(options: {
  message: string;
  default?: string;
  validate?: (value: string) => boolean | string;
}): Promise<string> {
  const { result } = await inquirer.prompt([{
    type: 'input',
    name: 'result',
    message: options.message,
    default: options.default,
    validate: options.validate,
  }]);
  return result;
}

/**
 * Select from a list.
 */
export async function select<T>(options: {
  message: string;
  choices: Array<{ name: string; value: T }>;
  default?: T;
}): Promise<T> {
  const { result } = await inquirer.prompt([{
    type: 'list',
    name: 'result',
    message: options.message,
    choices: options.choices,
    default: options.default,
  }]);
  return result;
}
