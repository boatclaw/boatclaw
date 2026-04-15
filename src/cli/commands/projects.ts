/**
 * Project management commands.
 *
 * Commands:
 * - projects: List all projects
 * - projects add: Add a new project
 * - projects remove: Remove a project
 * - projects show: Show project details
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as readline from 'readline';
import { configManager, ProjectConfig } from '../../core/config.js';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';
import * as ui from '../ui.js';
import { selectPath, detectGitHubRepo, isGitRepo, getDefaultBranch } from '../prompts.js';
import { isInitialized } from '../../core/paths.js';

export function registerProjectsCommands(program: Command): void {
  const projects = program
    .command('projects')
    .description('Manage projects (repositories)');

  // List projects (default action)
  projects
    .action(() => {
      listProjects();
    });

  // List subcommand
  projects
    .command('list')
    .description('List all configured projects')
    .action(() => {
      listProjects();
    });

  // Add project
  projects
    .command('add')
    .description('Add a new project')
    .option('--name <name>', 'Project name')
    .option('--path <path>', 'Local repository path')
    .option('--github <repo>', 'GitHub repository (owner/repo)')
    .option('--context <file>', 'Context file path (relative to repo)')
    .action(async (options: {
      name?: string;
      path?: string;
      github?: string;
      context?: string;
    }) => {
      await addProject(options);
    });

  // Remove project
  projects
    .command('remove <name>')
    .alias('rm')
    .description('Remove a project')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name: string, options: { force?: boolean }) => {
      await removeProject(name, options);
    });

  // Show project details
  projects
    .command('show <name>')
    .description('Show project details')
    .action((name: string) => {
      showProject(name);
    });

  // Edit project context
  projects
    .command('context <name>')
    .description('Add or edit project context')
    .action(async (name: string) => {
      await editProjectContext(name);
    });
}

function listProjects(): void {
  const projects = configManager.getProjects();
  const projectList = Object.values(projects);

  console.log();
  console.log(chalk.bold('  Projects'));
  console.log(chalk.dim(`  ${projectList.length} project(s) configured`));
  console.log();

  if (projectList.length === 0) {
    ui.dim('  No projects configured.');
    console.log();
    ui.actions([
      { cmd: 'boatclaw projects add', desc: 'Add a new project' },
    ]);
    return;
  }

  for (let i = 0; i < projectList.length; i++) {
    const project = projectList[i];
    const isLast = i === projectList.length - 1;
    const prefix = isLast ? '└─' : '├─';
    const linePrefix = isLast ? '  ' : '│ ';

    console.log('  ' + chalk.cyan(prefix) + ' ' + chalk.bold(project.name));
    console.log('  ' + chalk.cyan(linePrefix) + '   Path     ' + chalk.dim(project.path));
    if (project.github) {
      console.log('  ' + chalk.cyan(linePrefix) + '   GitHub   ' + chalk.white(project.github));
    }
    console.log('  ' + chalk.cyan(linePrefix) + '   Branch   ' + chalk.dim(project.baseBranch || 'main'));
    if (project.context || project.contextFile) {
      const contextSource = project.context ? '✓ Set' : `✓ From file: ${project.contextFile}`;
      console.log('  ' + chalk.cyan(linePrefix) + '   Context  ' + chalk.green(contextSource));
    }

    if (!isLast) console.log('  ' + chalk.cyan('│'));
  }

  ui.actions([
    { cmd: 'boatclaw projects add', desc: 'Add a new project' },
    { cmd: 'boatclaw projects show <name>', desc: 'View project details' },
    { cmd: 'boatclaw projects remove <name>', desc: 'Remove a project' },
    { cmd: 'boatclaw projects context <name>', desc: 'Edit project context' },
  ]);
}

async function addProject(options: {
  name?: string;
  path?: string;
  github?: string;
  context?: string;
}): Promise<void> {
  if (!isInitialized()) {
    ui.error('Boatclaw is not configured.');
    ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
    return;
  }

  console.log();
  console.log(chalk.bold('Add Project'));
  console.log(chalk.dim('Add a repository for agents to work on.'));
  console.log();

  // Local path - use file browser
  let localPath = options.path;
  if (!localPath) {
    console.log(chalk.dim('Navigate to select your project folder:'));
    localPath = await selectPath({
      message: 'Project folder:',
      startPath: process.cwd(),
      onlyDirectories: true,
    });
  }

  // Validate path exists
  const resolvedPath = resolve(localPath!);
  if (!existsSync(resolvedPath)) {
    ui.error(`Path does not exist: ${resolvedPath}`);
    return;
  }

  // Project name - default to folder name
  let name = options.name;
  if (!name) {
    const defaultName = basename(resolvedPath).toLowerCase().replace(/\s+/g, '-');
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'name',
      message: 'Project name:',
      default: defaultName,
      validate: (value: string) => {
        if (!value.trim()) return 'Name is required';
        if (configManager.getProject(value)) return 'Project already exists';
        return true;
      },
    }]);
    name = answers.name;
  }

  // Check if already exists
  if (configManager.getProject(name!)) {
    ui.error(`Project "${name}" already exists.`);
    return;
  }

  // Auto-detect GitHub from git remote
  let github = options.github;
  if (!github && isGitRepo(resolvedPath)) {
    const detected = detectGitHubRepo(resolvedPath);
    if (detected) {
      ui.success(`Detected GitHub: ${detected}`);
      const { useDetected } = await inquirer.prompt([{
        type: 'confirm',
        name: 'useDetected',
        message: 'Use this for PR creation?',
        default: true,
      }]);
      if (useDetected) {
        github = detected;
      }
    }
  }

  // If not detected, ask if they want to add manually
  if (!github) {
    const { wantGitHub } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantGitHub',
      message: 'Add GitHub repo for PR creation? (optional)',
      default: false,
    }]);

    if (wantGitHub) {
      const answers = await inquirer.prompt([{
        type: 'input',
        name: 'github',
        message: 'GitHub repository (owner/repo):',
        validate: (value: string) => {
          if (!value.includes('/')) {
            return 'Format: owner/repo (e.g., myorg/myproject)';
          }
          return true;
        },
      }]);
      github = answers.github;
    }
  }

  // Context - ask if they want to add now (stored in config, not as file)
  let context: string | undefined;
  const { addContext } = await inquirer.prompt([{
    type: 'confirm',
    name: 'addContext',
    message: 'Add context for this project? (tech stack, coding style, etc.)',
    default: false,
  }]);

  if (addContext) {
    showProjectContextHints();
    context = await inputContextInline('Enter project context:');
  }

  // Auto-detect base branch
  let baseBranch = 'main';
  if (isGitRepo(resolvedPath)) {
    baseBranch = getDefaultBranch(resolvedPath);
    ui.dim(`Detected base branch: ${baseBranch}`);
  }

  // Create project config
  const project: ProjectConfig = {
    name: name!,
    path: resolvedPath,
    github: github || undefined,
    context,
    baseBranch,
    branchPrefix: 'feature/',
  };

  // Save
  configManager.setProject(name!, project);

  console.log();
  ui.success(`Project "${name}" added!`);
  console.log();
  ui.keyValue('Path', resolvedPath);
  ui.keyValue('GitHub', github || chalk.dim('Not configured'));
  ui.keyValue('Base branch', baseBranch);
  if (context) {
    ui.keyValue('Context', chalk.green('✓ Set'));
  }
  console.log();
}

async function removeProject(name: string, options: { force?: boolean }): Promise<void> {
  const project = configManager.getProject(name);

  if (!project) {
    ui.error(`Project "${name}" not found.`);
    console.log();
    listProjects();
    return;
  }

  // Confirm unless force
  if (!options.force) {
    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: `Remove project "${name}"?`,
      default: false,
    }]);

    if (!confirmed) {
      ui.info('Cancelled.');
      return;
    }
  }

  // Check if any agents reference this project
  const agents = configManager.getRoles();
  const referencingAgents = Object.values(agents).filter(
    (a) => a.projects?.includes(name)
  );

  if (referencingAgents.length > 0) {
    ui.warning(`The following agents reference this project:`);
    for (const agent of referencingAgents) {
      console.log(`  - ${agent.name}`);
    }
    console.log();
    ui.info('Consider updating them with: boatclaw agents remove/add');
  }

  configManager.removeProject(name);
  ui.success(`Project "${name}" removed.`);
}

function showProject(name: string): void {
  const project = configManager.getProject(name);

  if (!project) {
    ui.error(`Project "${name}" not found.`);
    console.log();
    listProjects();
    return;
  }

  console.log();
  console.log(chalk.bold(`Project: ${project.name}`));
  console.log();

  ui.keyValue('Path', project.path);
  ui.keyValue('GitHub', project.github || chalk.dim('Not configured'));
  const projectContextText = project.context
    ? chalk.green('✓ Set')
    : (project.contextFile ? chalk.green(`✓ From file: ${project.contextFile}`) : chalk.dim('Not set'));
  ui.keyValue('Context', projectContextText);
  ui.keyValue('Base Branch', project.baseBranch || 'main');
  ui.keyValue('Branch Prefix', project.branchPrefix || 'feature/');

  // Check if path exists
  if (!existsSync(project.path)) {
    console.log();
    ui.warning('Path does not exist on this machine');
  }

  // Show which agents work on this project
  const agents = configManager.getRoles();
  const assignedAgents = Object.values(agents).filter(
    (a) => a.projects?.includes('*') || a.projects?.includes(name)
  );

  if (assignedAgents.length > 0) {
    console.log();
    console.log(chalk.dim('Agents assigned to this project:'));
    for (const agent of assignedAgents) {
      const scope = agent.projects?.includes('*') ? '(all projects)' : '';
      console.log(`  - ${agent.name} ${chalk.dim(scope)}`);
    }
  }

  // Show context if exists (inline or from file)
  if (project.context) {
    console.log();
    console.log(chalk.dim('Context:'));
    console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
    const lines = project.context.split('\n');
    for (const line of lines.slice(0, 10)) {
      console.log(chalk.cyan('  │') + ' ' + line.slice(0, 49).padEnd(49) + chalk.cyan('│'));
    }
    if (lines.length > 10) {
      console.log(chalk.cyan('  │') + chalk.dim(' ... (truncated)'.padEnd(49)) + chalk.cyan('│'));
    }
    console.log(chalk.cyan('  └' + '─'.repeat(50) + '┘'));
  } else if (project.contextFile) {
    console.log();
    console.log(chalk.dim(`Context from file: ${project.contextFile}`));
  }

  console.log();
}

async function editProjectContext(name: string): Promise<void> {
  if (!isInitialized()) {
    ui.error('Boatclaw is not configured.');
    ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
    return;
  }

  const project = configManager.getProject(name);

  if (!project) {
    ui.error(`Project "${name}" not found.`);
    return;
  }

  console.log();
  console.log(chalk.bold(`  Project: ${name}`));
  console.log();

  // Show current context if any
  if (project.context) {
    console.log(chalk.dim('  Current context:'));
    console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
    const lines = project.context.split('\n');
    for (const line of lines) {
      console.log(chalk.cyan('  │') + ' ' + line.padEnd(49) + chalk.cyan('│'));
    }
    console.log(chalk.cyan('  └' + '─'.repeat(50) + '┘'));
    console.log();

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Edit (replace)', value: 'edit' },
        { name: 'Add more text', value: 'append' },
        { name: 'Clear context', value: 'clear' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    if (action === 'clear') {
      project.context = undefined;
      configManager.setProject(name, project);
      ui.success('Context cleared');
      return;
    }

    // Show current context again before editing
    console.log();
    console.log(chalk.dim('  Current context:'));
    console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
    for (const line of project.context.split('\n')) {
      console.log(chalk.cyan('  │') + ' ' + line.padEnd(49) + chalk.cyan('│'));
    }
    console.log(chalk.cyan('  └' + '─'.repeat(50) + '┘'));

    const newText = await inputContextInline(action === 'edit' ? 'Enter new context:' : 'Add more context:');

    if (newText) {
      project.context = action === 'edit' ? newText : project.context + '\n\n' + newText;
      configManager.setProject(name, project);
      ui.success('Context updated');
    }
  } else {
    console.log(chalk.dim('  No context set for this project.'));
    console.log();

    const { wantAdd } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantAdd',
      message: 'Add context now?',
      default: true,
    }]);

    if (wantAdd) {
      showProjectContextHints();
      const newText = await inputContextInline('Enter project context:');
      if (newText) {
        project.context = newText;
        configManager.setProject(name, project);
        ui.success('Context saved');
      }
    }
  }
}

function showProjectContextHints(): void {
  console.log();
  console.log(chalk.dim('  Hint: Good project context includes:'));
  console.log(chalk.dim('  - Tech stack (e.g., Node.js, TypeScript, React, PostgreSQL)'));
  console.log(chalk.dim('  - Framework and libraries (e.g., Express, Prisma, Jest)'));
  console.log(chalk.dim('  - Project structure (e.g., src/routes, src/services, src/models)'));
  console.log(chalk.dim('  - Coding conventions (e.g., async/await, no classes, functional style)'));
  console.log(chalk.dim('  - Important constraints (e.g., must support Node 18, no external APIs)'));
  console.log();
  console.log(chalk.dim('  Example:'));
  console.log(chalk.dim('  Node.js 20 + TypeScript + Express API'));
  console.log(chalk.dim('  PostgreSQL with Prisma ORM'));
  console.log(chalk.dim('  Jest for testing, async/await only'));
  console.log(chalk.dim('  src/routes for endpoints, src/services for business logic'));
  console.log();
}

/**
 * Simple inline text input for context.
 */
const MAX_CONTEXT_LENGTH = 5000;

async function inputContextInline(prompt: string): Promise<string> {
  console.log();
  console.log(chalk.bold('  ' + prompt));
  console.log(chalk.dim('  Type your text. Press Enter for new line. Empty line to finish.'));
  console.log(chalk.dim(`  Max ${MAX_CONTEXT_LENGTH} characters. For longer context, use a contextFile.`));
  console.log(chalk.cyan('  ─'.repeat(25)));

  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('  │ '),
    });

    const lines: string[] = [];

    rl.prompt();

    rl.on('line', (line: string) => {
      if (line === '' && lines.length > 0) {
        const result = lines.join('\n').trim();
        if (result.length > MAX_CONTEXT_LENGTH) {
          console.log(chalk.yellow(`  ⚠ Context too long (${result.length}/${MAX_CONTEXT_LENGTH} chars). Trimmed.`));
          console.log(chalk.dim(`  Tip: Use a contextFile for longer context.`));
          rl.close();
          console.log(chalk.cyan('  ─'.repeat(25)));
          res(result.slice(0, MAX_CONTEXT_LENGTH));
          return;
        }
        rl.close();
        console.log(chalk.cyan('  ─'.repeat(25)));
        res(result);
        return;
      }

      if (line !== '' || lines.length > 0) {
        lines.push(line);
      }
      rl.prompt();
    });

    rl.on('close', () => {
      const result = lines.join('\n').trim();
      res(result);
    });
  });
}
