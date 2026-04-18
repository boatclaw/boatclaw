/**
 * Agent management commands.
 *
 * Commands:
 * - agents: List all agents
 * - agents add: Add a new agent
 * - agents remove <name>: Remove an agent
 * - agents enable <name>: Enable an agent
 * - agents disable <name>: Disable an agent
 * - agents context <name>: Add/edit agent context
 * - agents ask [name]: Run a task with an agent from the terminal
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import * as readline from 'readline';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { configManager, type RoleConfig, type ProjectConfig } from '../../core/config.js';
import { isInitialized } from '../../core/paths.js';
import * as ui from '../ui.js';
import { createTaskProcessor, type TaskProcessorOptions } from '../../ai/task-processor.js';
import { createAIProvider } from '../../ai/index.js';
import { createReviewerAgent } from '../../github/reviewer.js';
import { GitHubClient } from '../../github/client.js';
import type { Card, BoardProvider, CardOperationResult, Comment } from '../../platforms/types.js';

export function registerAgentsCommands(program: Command): void {
  const agents = program
    .command('agents')
    .description('AI agent management');

  // Default action: list agents
  agents.action(() => {
    listAgents();
  });

  // List agents
  agents
    .command('list')
    .description('List all configured agents')
    .action(() => {
      listAgents();
    });

  // Add agent
  agents
    .command('add')
    .description('Add a new agent')
    .action(async () => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
        return;
      }

      await addAgent();
    });

  // Remove agent
  agents
    .command('remove <name>')
    .alias('rm')
    .description('Remove an agent')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (name: string, options: { yes?: boolean }) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        return;
      }

      const existingAgents = configManager.getRoles();

      if (!(name in existingAgents)) {
        ui.error(`Agent "${name}" not found.`);
        ui.info('Available agents: ' + Object.keys(existingAgents).join(', '));
        return;
      }

      if (!options.yes) {
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          message: `Remove agent "${name}"?`,
          default: false,
        }]);

        if (!confirmed) {
          ui.info('Cancelled.');
          return;
        }
      }

      const removed = configManager.removeRole(name);

      if (removed) {
        ui.success(`Agent "${name}" removed.`);
      } else {
        ui.error(`Failed to remove agent "${name}".`);
      }
    });

  // Enable agent
  agents
    .command('enable <name>')
    .description('Enable an agent')
    .action(async (name: string) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        return;
      }

      const existingAgents = configManager.getRoles();

      if (!(name in existingAgents)) {
        ui.error(`Agent "${name}" not found.`);
        return;
      }

      const agent = existingAgents[name];
      agent.enabled = true;
      configManager.setRole(name, agent);

      ui.success(`Agent "${name}" enabled.`);
    });

  // Disable agent
  agents
    .command('disable <name>')
    .description('Disable an agent')
    .action(async (name: string) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        return;
      }

      const existingAgents = configManager.getRoles();

      if (!(name in existingAgents)) {
        ui.error(`Agent "${name}" not found.`);
        return;
      }

      const agent = existingAgents[name];
      agent.enabled = false;
      configManager.setRole(name, agent);

      ui.success(`Agent "${name}" disabled.`);
    });

  // Show agent details
  agents
    .command('show <name>')
    .description('Show agent details')
    .action(async (name: string) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        return;
      }

      const existingAgents = configManager.getRoles();

      if (!(name in existingAgents)) {
        ui.error(`Agent "${name}" not found.`);
        return;
      }

      const agent = existingAgents[name];

      console.log();
      console.log(chalk.bold(`Agent: ${agent.name}`));
      console.log();
      ui.keyValue('Labels', agent.labels?.join(', ') || agent.label || 'None');
      ui.keyValue('Projects', agent.projects?.includes('*') ? 'All projects' : agent.projects?.join(', ') || 'None');
      ui.keyValue('Provider', agent.provider || configManager.get<string>('ai.provider') || 'claude');
      ui.keyValue('Model', agent.model);
      const agentContextText = agent.context
        ? chalk.green('✓ Set')
        : (agent.contextFile ? chalk.green(`✓ From file: ${agent.contextFile}`) : chalk.dim('Not set'));
      ui.keyValue('Context', agentContextText);
      ui.keyValue('Status', agent.enabled ? chalk.green('Enabled') : chalk.dim('Disabled'));

      // Show which projects this agent will work on
      if (agent.projects?.includes('*')) {
        const projects = Object.keys(configManager.getProjects());
        if (projects.length > 0) {
          console.log();
          console.log(chalk.dim('Will work on all projects:'));
          for (const p of projects) {
            console.log(`  - ${p}`);
          }
        }
      }

      // Show context if exists (inline or from file)
      if (agent.context) {
        console.log();
        console.log(chalk.dim('Context:'));
        console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
        const lines = agent.context.split('\n');
        for (const line of lines.slice(0, 10)) {
          console.log(chalk.cyan('  │') + ' ' + line.slice(0, 49).padEnd(49) + chalk.cyan('│'));
        }
        if (lines.length > 10) {
          console.log(chalk.cyan('  │') + chalk.dim(' ... (truncated)'.padEnd(49)) + chalk.cyan('│'));
        }
        console.log(chalk.cyan('  └' + '─'.repeat(50) + '┘'));
      } else if (agent.contextFile) {
        console.log();
        console.log(chalk.dim(`Context from file: ${agent.contextFile}`));
      }

      console.log();
    });

  // Add/edit context
  agents
    .command('context <name>')
    .description('Add or edit agent context (type directly in terminal)')
    .action(async (name: string) => {
      await editAgentContext(name);
    });

  // Edit agent scope (projects)
  agents
    .command('scope <name>')
    .description('Change which projects an agent works on')
    .action(async (name: string) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        return;
      }

      const existingAgents = configManager.getRoles();
      if (!(name in existingAgents)) {
        ui.error(`Agent "${name}" not found.`);
        return;
      }

      const agent = existingAgents[name];
      const projects = Object.keys(configManager.getProjects());

      if (projects.length === 0) {
        ui.error('No projects configured. Add projects first with: boatclaw projects add');
        return;
      }

      // Show current scope
      const currentScope = agent.projects?.includes('*') ? 'All projects' : agent.projects?.join(', ') || 'None';
      ui.keyValue('Current scope', currentScope);
      console.log();

      const { projectSelection } = await inquirer.prompt([{
        type: 'list',
        name: 'projectSelection',
        message: 'Which projects should this agent work on?',
        choices: [
          { name: 'All projects', value: 'all' },
          { name: 'Select specific projects', value: 'select' },
        ],
      }]);

      if (projectSelection === 'all') {
        agent.projects = ['*'];
      } else {
        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: 'Select projects (space to select, enter to confirm):',
          choices: projects.map((p) => ({
            name: p,
            value: p,
            checked: agent.projects?.includes(p) || agent.projects?.includes('*'),
          })),
          validate: (answer: string[]) => {
            if (answer.length === 0) return 'Select at least one project';
            return true;
          },
        }]);
        agent.projects = selected;
      }

      configManager.setRole(name, agent);
      const newScope = agent.projects.includes('*') ? 'All projects' : agent.projects.join(', ');
      ui.success(`Agent "${name}" scope updated: ${newScope}`);
    });

  // Ask agent (run full pipeline from terminal)
  agents
    .command('ask [name]')
    .description('Run a task with an agent from the terminal')
    .option('-p, --project <project>', 'Limit to a specific project')
    .option('--pr', 'Create PR (default: yes if GitHub enabled)')
    .option('--no-pr', 'Skip PR creation')
    .option('--review', 'Run AI review after (default: yes)')
    .option('--no-review', 'Skip review')
    .option('-i, --interactive', 'Enable interactive mode — AI can ask questions (Claude only)')
    .action(async (name: string | undefined, options: { project?: string; pr?: boolean; review?: boolean; interactive?: boolean }) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
        return;
      }

      await askAgent(name, options);
    });
}

async function addAgent(): Promise<void> {
  const currentAgents = Object.keys(configManager.getRoles());
  const projects = Object.keys(configManager.getProjects());

  console.log();
  console.log(chalk.bold('Add New Agent'));
  console.log(chalk.dim('Agents are AI workers that pick up tasks from your board.'));
  console.log();

  // Agent name
  const { name } = await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Agent name:',
    validate: (value: string) => {
      if (!value.trim()) return 'Name is required';
      const normalized = value.toLowerCase().replace(/\s+/g, '-');
      if (currentAgents.includes(normalized)) {
        return 'Agent with this name already exists';
      }
      return true;
    },
    filter: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
  }]);

  const normalizedName = name.toLowerCase().replace(/\s+/g, '-');

  // Label (what card label triggers this agent)
  console.log();
  console.log(chalk.dim('Cards with matching labels will be assigned to this agent.'));
  // Collect existing labels from all agents
  const existingLabels = new Set<string>();
  for (const agent of Object.values(configManager.getRoles())) {
    for (const label of (agent.labels || [])) {
      existingLabels.add(label.toLowerCase());
    }
  }

  const { labelInput } = await inquirer.prompt([{
    type: 'input',
    name: 'labelInput',
    message: 'Card label to match:',
    default: normalizedName,
    validate: (value: string) => {
      const inputLabels = value.split(',').map(l => l.trim().toLowerCase()).filter(l => l);
      if (inputLabels.length === 0) return 'At least one label is required';
      const duplicates = inputLabels.filter(l => existingLabels.has(l));
      if (duplicates.length > 0) {
        return `Label "${duplicates[0]}" is already used by another agent`;
      }
      return true;
    },
  }]);

  const labels = labelInput.split(',').map((l: string) => l.trim()).filter((l: string) => l);

  // Project assignment
  let selectedProjects: string[] = ['*'];

  if (projects.length > 0) {
    const { projectSelection } = await inquirer.prompt([{
      type: 'list',
      name: 'projectSelection',
      message: 'Which projects should this agent work on?',
      choices: [
        { name: 'All projects', value: 'all' },
        { name: 'Select specific projects', value: 'select' },
      ],
    }]);

    if (projectSelection === 'select') {
      const { selected } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selected',
        message: 'Select projects (space to select, enter to confirm):',
        choices: projects.map((p) => ({ name: p, value: p })),
        validate: (answer: string[]) => {
          if (answer.length === 0) {
            return 'Please select at least one project (use space to select)';
          }
          return true;
        },
      }]);
      selectedProjects = selected;
    }
  } else {
    ui.dim('No projects configured yet. Add projects with: boatclaw projects add');
  }

  // Provider selection (if multiple available)
  const availableProviders = configManager.get<string[]>('ai.availableProviders') || [configManager.get<string>('ai.provider') || 'claude'];
  let provider: string | undefined;

  if (availableProviders.length > 1) {
    const { providerChoice } = await inquirer.prompt([{
      type: 'list',
      name: 'providerChoice',
      message: 'AI provider for this agent:',
      choices: availableProviders.map((p) => ({
        name: p === 'claude' ? 'Claude CLI' : 'Cursor CLI',
        value: p,
      })),
    }]);
    provider = providerChoice;
  }

  // Model selection
  const { model } = await inquirer.prompt([{
    type: 'list',
    name: 'model',
    message: 'AI model:',
    choices: [
      { name: 'Sonnet (recommended)', value: 'sonnet' },
      { name: 'Haiku (fast, simple tasks)', value: 'haiku' },
      { name: 'Opus (complex tasks)', value: 'opus' },
      { name: 'Auto (smart selection)', value: 'auto' },
    ],
    default: 'sonnet',
  }]);

  // Context - ask if they want to add now
  const { addContext } = await inquirer.prompt([{
    type: 'confirm',
    name: 'addContext',
    message: 'Add context for this agent now? (coding style, preferences, etc.)',
    default: false,
  }]);

  let context: string | undefined;
  if (addContext) {
    showAgentContextHints();
    context = await inputContextInline('Enter agent context:');
  }

  const agent: RoleConfig = {
    name: normalizedName,
    labels,
    projects: selectedProjects,
    provider: provider as 'claude' | 'cursor' | undefined,
    model: model as 'auto' | 'haiku' | 'sonnet' | 'opus',
    enabled: true,
    context,
  };

  configManager.setRole(normalizedName, agent);

  console.log();
  ui.success(`Agent "${normalizedName}" added!`);
  console.log();
  ui.keyValue('Name', agent.name);
  ui.keyValue('Labels', labels.join(', '));
  ui.keyValue('Projects', selectedProjects.includes('*') ? 'All' : selectedProjects.join(', '));
  if (provider) {
    ui.keyValue('Provider', provider);
  }
  ui.keyValue('Model', agent.model);
  if (context) {
    ui.keyValue('Context', chalk.green('✓ Set'));
  }
  console.log();
}

async function editAgentContext(name: string): Promise<void> {
  if (!isInitialized()) {
    ui.error('Boatclaw is not configured.');
    ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
    return;
  }

  const existingAgents = configManager.getRoles();

  if (!(name in existingAgents)) {
    ui.error(`Agent "${name}" not found.`);
    return;
  }

  const agent = existingAgents[name];

  console.log();
  console.log(chalk.bold(`  Agent: ${name}`));
  console.log();

  // Show current context if any
  if (agent.context) {
    console.log(chalk.dim('  Current context:'));
    console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
    const lines = agent.context.split('\n');
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
      agent.context = undefined;
      configManager.setRole(name, agent);
      ui.success('Context cleared');
      return;
    }

    // Show current context again before editing
    console.log();
    console.log(chalk.dim('  Current context:'));
    console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
    for (const line of agent.context.split('\n')) {
      console.log(chalk.cyan('  │') + ' ' + line.padEnd(49) + chalk.cyan('│'));
    }
    console.log(chalk.cyan('  └' + '─'.repeat(50) + '┘'));

    const newText = await inputContextInline(action === 'edit' ? 'Enter new context:' : 'Add more context:');

    if (newText) {
      agent.context = action === 'edit' ? newText : agent.context + '\n\n' + newText;
      configManager.setRole(name, agent);
      ui.success('Context updated');
    }
  } else {
    console.log(chalk.dim('  No context set for this agent.'));
    console.log();

    const { wantAdd } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantAdd',
      message: 'Add context now?',
      default: true,
    }]);

    if (wantAdd) {
      showAgentContextHints();
      const newText = await inputContextInline('Enter agent context:');
      if (newText) {
        agent.context = newText;
        configManager.setRole(name, agent);
        ui.success('Context saved');
      }
    }
  }
}

function showAgentContextHints(): void {
  console.log();
  console.log(chalk.dim('  Hint: Good agent context includes:'));
  console.log(chalk.dim('  - Role and expertise (e.g., senior backend engineer)'));
  console.log(chalk.dim('  - Coding style (e.g., write tests first, use functional patterns)'));
  console.log(chalk.dim('  - Quality standards (e.g., always add error handling, write JSDoc)'));
  console.log(chalk.dim('  - What to avoid (e.g., no console.log, no any types)'));
  console.log(chalk.dim('  - Review expectations (e.g., keep PRs small, explain decisions)'));
  console.log();
  console.log(chalk.dim('  Example:'));
  console.log(chalk.dim('  Senior backend engineer'));
  console.log(chalk.dim('  Write unit tests for all new functions'));
  console.log(chalk.dim('  Use TypeScript strict mode, no any types'));
  console.log(chalk.dim('  Follow existing patterns in the codebase'));
  console.log(chalk.dim('  Keep changes minimal and focused'));
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

/**
 * Create a terminal-based board provider that prints comments to console.
 * Used by the reviewer when running from the terminal (no real board).
 */
function createTerminalBoardProvider(): BoardProvider {
  return {
    name: 'terminal',
    verifyConnection: async () => true,
    getBoard: async () => ({ id: '', name: 'Terminal', url: '', lists: [] }),
    getLists: async () => [],
    getCards: async () => [],
    getCard: async () => null,
    moveCard: async (): Promise<CardOperationResult> => ({ success: true }),
    addComment: async (_cardId: string, text: string): Promise<CardOperationResult> => {
      // Strip markdown bold for terminal display
      const clean = text.replace(/\*\*(.+?)\*\*/g, '$1');
      console.log(chalk.dim('  │ ') + clean.split('\n').join('\n' + chalk.dim('  │ ')));
      return { success: true };
    },
    getComments: async (): Promise<Comment[]> => [],
    updateDescription: async (): Promise<CardOperationResult> => ({ success: true }),
    addLabel: async (): Promise<CardOperationResult> => ({ success: true }),
    removeLabel: async (): Promise<CardOperationResult> => ({ success: true }),
    getLabels: async () => [],
    close: async () => {},
  };
}

/**
 * Read task description from the user.
 * Same style as context input — bordered, with prompt prefix.
 */
async function readTaskInput(): Promise<string> {
  console.log();
  console.log(chalk.bold('  Describe the task:'));
  console.log(chalk.dim('  Type your task. Press Enter for new line. Empty line to submit.'));
  console.log(chalk.cyan('  ─'.repeat(25)));

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('  │ '),
    });

    const lines: string[] = [];

    rl.prompt();

    rl.on('line', (line: string) => {
      if (line === '' && lines.length > 0) {
        rl.close();
        console.log(chalk.cyan('  ─'.repeat(25)));
        resolve(lines.join('\n').trim());
        return;
      }

      if (line !== '' || lines.length > 0) {
        lines.push(line);
      }
      rl.prompt();
    });

    rl.on('close', () => {
      console.log(chalk.cyan('  ─'.repeat(25)));
      resolve(lines.join('\n').trim());
    });
  });
}

async function askAgent(name: string | undefined, options: { project?: string; pr?: boolean; review?: boolean; interactive?: boolean }): Promise<void> {
  const existingAgents = configManager.getRoles();
  const agentNames = Object.keys(existingAgents);

  if (agentNames.length === 0) {
    ui.error('No agents configured.');
    ui.info(`Run ${chalk.cyan('boatclaw agents add')} to create one.`);
    return;
  }

  // Select agent if not specified
  let agentName = name;
  if (!agentName) {
    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message: 'Select agent:',
      choices: agentNames.map(n => {
        const a = existingAgents[n];
        return { name: `${n} (${a.labels.join(', ')})`, value: n };
      }),
    }]);
    agentName = selected;
  }

  if (!(agentName! in existingAgents)) {
    ui.error(`Agent "${agentName}" not found.`);
    ui.info('Available: ' + agentNames.join(', '));
    return;
  }

  const agent = existingAgents[agentName!];
  const config = configManager.load();
  const allProjects = config.projects;

  // Resolve projects for this agent
  let agentProjects: ProjectConfig[] = [];
  if (options.project) {
    const p = allProjects[options.project];
    if (!p) {
      ui.error(`Project "${options.project}" not found.`);
      return;
    }
    agentProjects = [p];
  } else if (agent.projects.includes('*')) {
    agentProjects = Object.values(allProjects);
  } else {
    agentProjects = agent.projects
      .map(n => allProjects[n])
      .filter((p): p is ProjectConfig => !!p);
  }

  if (agentProjects.length === 0) {
    ui.error('No valid projects found for this agent.');
    return;
  }

  // Determine GitHub and review settings
  const githubEnabled = config.github.enabled && !!config.github.token;
  let createPRs = options.pr !== undefined ? options.pr : githubEnabled;
  let runReview = options.review !== undefined ? options.review : true;

  // Ask user if flags not explicitly set
  if (options.pr === undefined && options.review === undefined) {
    if (githubEnabled) {
      const answers = await inquirer.prompt([
        { type: 'confirm', name: 'pr', message: 'Create PR?', default: true },
        { type: 'confirm', name: 'review', message: 'Run AI review?', default: true },
      ]);
      createPRs = answers.pr;
      runReview = answers.review;
    } else {
      const { review } = await inquirer.prompt([
        { type: 'confirm', name: 'review', message: 'Run AI review?', default: true },
      ]);
      createPRs = false;
      runReview = review;
    }
  }

  // Determine interactive mode (Claude only)
  const provider = agent.provider || config.ai.provider || 'claude';
  const interactiveEnabled = !!(options.interactive && provider === 'claude');
  if (options.interactive && provider !== 'claude') {
    ui.warning('Interactive mode is only supported with Claude. Continuing without it.');
  }

  // Show header
  const projectNames = agentProjects.map(p => p.name).join(', ');
  const interactiveLabel = interactiveEnabled ? ' | Interactive' : '';
  console.log();
  console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
  console.log(chalk.cyan('  │') + chalk.bold(` Boatclaw — ${agent.name}`.padEnd(50)) + chalk.cyan('│'));
  console.log(chalk.cyan('  │') + chalk.dim(` Model: ${agent.model} | PR: ${createPRs ? 'yes' : 'no'} | Review: ${runReview ? 'yes' : 'no'}${interactiveLabel}`.padEnd(50)) + chalk.cyan('│'));
  console.log(chalk.cyan('  │') + chalk.dim(` Projects: ${projectNames}`.slice(0, 52).padEnd(50)) + chalk.cyan('│'));
  console.log(chalk.cyan('  └' + '─'.repeat(50) + '┘'));
  console.log();

  // Get task description from user
  const taskInput = await readTaskInput();
  if (!taskInput.trim()) {
    ui.error('No task description provided.');
    return;
  }

  // Build a fake Card from the terminal input
  const firstLine = taskInput.split('\n')[0].trim();
  const card: Card = {
    id: `terminal-${Date.now()}`,
    title: firstLine,
    description: taskInput,
    url: '',
    labels: agent.labels.map(l => ({ id: l, name: l })),
    listId: '',
    listName: '',
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignees: [],
    metadata: {},
  };

  const startTime = Date.now();

  // --- Execution phase ---
  console.log();
  console.log(chalk.bold('  Boatclaw started'));
  console.log(chalk.dim(`  Agent: ${agent.name} | Model: ${agent.model}`));
  console.log(chalk.dim(`  Projects: ${projectNames}`));
  console.log();

  // Set up interactive mode (file-based ask/answer for terminal)
  let askDir: string | undefined;
  let askWatcherCleanup: (() => void) | undefined;

  if (interactiveEnabled) {
    askDir = join(tmpdir(), `boatclaw-ask-${Date.now()}`);
    mkdirSync(askDir, { recursive: true });
    askWatcherCleanup = startAskWatcher(askDir);

    // Cleanup on unexpected exit (Ctrl+C, crash)
    const cleanupOnExit = () => {
      if (askWatcherCleanup) askWatcherCleanup();
      if (askDir && existsSync(askDir)) rmSync(askDir, { recursive: true, force: true });
    };
    process.on('SIGINT', cleanupOnExit);
    process.on('SIGTERM', cleanupOnExit);
    process.on('exit', cleanupOnExit);
  }

  // Create task processor (same as worker)
  const processorOptions: TaskProcessorOptions = {
    createPRs: createPRs && githubEnabled,
    githubToken: config.github.token,
    interactive: interactiveEnabled,
  };

  // For interactive terminal mode, override the MCP config to use file-based provider
  if (interactiveEnabled && askDir) {
    processorOptions.mcpConfig = {
      cardId: card.id,
      boardProvider: 'terminal',
      askDir,
    };
  }

  const processor = createTaskProcessor(processorOptions);

  // Check AI availability
  if (!(await processor.isAvailable())) {
    ui.error('AI provider is not available. Make sure the CLI is installed and authenticated.');
    return;
  }

  // Handle Ctrl+C — stop spinner and exit cleanly
  let interrupted = false;
  const handleInterrupt = () => {
    interrupted = true;
    if (spinner) spinner.stop();
    console.log();
    console.log(chalk.yellow('  ⚠ Interrupted. Cleaning up...'));
    // Force exit — child processes (non-detached) are killed by the OS
    process.exit(130);
  };
  process.on('SIGINT', handleInterrupt);

  // Process task across all projects
  const spinner = ora({ text: `Working on ${projectNames}...`, prefixText: ' ', color: 'cyan' }).start();

  const result = await processor.processMultiProject(card, agent, agentProjects, {
    onProjectComplete: async (projectResult) => {
      spinner.stop();
      const status = projectResult.success ? chalk.green('✅') : chalk.red('❌');
      const duration = `${Math.round(projectResult.durationMs / 1000)}s`;
      let line = `  ${status} ${chalk.bold(projectResult.projectName)} — ${duration}`;
      if (projectResult.prUrl) {
        line += ` — ${chalk.cyan(projectResult.prUrl)}`;
      }
      if (projectResult.error) {
        line += chalk.red(` — ${projectResult.error}`);
      }
      console.log(line);

      // Show AI output summary
      if (projectResult.output && projectResult.success) {
        // Try tagged summary first, then legacy, then last meaningful lines
        const taggedMatch = projectResult.output.match(/<!-- BOATCLAW_SUMMARY_START -->([\s\S]*?)<!-- BOATCLAW_SUMMARY_END -->/);
        const legacyMatch = projectResult.output.match(/\*\*What was done:?\*\*[\s\S]*?^---$/im);
        const summary = taggedMatch ? taggedMatch[1].trim()
          : legacyMatch ? legacyMatch[0].trim()
          : null;

        if (summary) {
          // Print structured summary with border
          const clean = summary.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^---$/gm, '');
          const lines = clean.split('\n').filter(l => l.trim());
          for (const l of lines) {
            console.log(chalk.dim('  │ ') + l.trim());
          }
        } else {
          // Show last few meaningful lines of output
          const lines = projectResult.output.split('\n').filter(l => l.trim()).slice(-5);
          for (const l of lines) {
            console.log(chalk.dim('  │ ') + l.trim().slice(0, 100));
          }
        }
      }

      console.log();
      // Restart spinner for next project if there are more
      spinner.start(`Working...`);
    },
  });

  spinner.stop();
  process.removeListener('SIGINT', handleInterrupt);

  // --- Review phase ---
  const prUrls: { project: string; prUrl: string; prNumber: number; repo: string }[] = [];
  if (result.projectResults) {
    for (const pr of result.projectResults) {
      if (pr.prUrl && pr.prNumber) {
        const proj = agentProjects.find(p => p.name === pr.projectName);
        if (proj?.github) {
          prUrls.push({ project: pr.projectName, prUrl: pr.prUrl, prNumber: pr.prNumber, repo: proj.github });
        }
      }
    }
  }

  if (runReview && result.success) {
    console.log();
    const reviewSpinner = ora({ text: 'Reviewing...', prefixText: ' ', color: 'yellow' }).start();

    const aiProvider = createAIProvider({
      provider: (config.ai.provider || 'claude') as 'claude' | 'cursor' | 'codex',
      defaultModel: 'sonnet',
      timeoutSeconds: config.ai.timeoutSeconds || 1800,
    });

    const terminalBoard = createTerminalBoardProvider();
    const reviewResults: { name: string; approved: boolean }[] = [];

    if (prUrls.length > 0 && config.github.token) {
      // GitHub PR review
      for (const pr of prUrls) {
        try {
          const githubClient = new GitHubClient({ token: config.github.token, defaultRepo: pr.repo });
          const reviewer = createReviewerAgent({
            boardProvider: terminalBoard,
            aiProvider,
            githubClient,
            workflow: config.workflow,
          });

          const reviewResult = await reviewer.processCardForReview({
            card,
            prNumber: pr.prNumber,
            repo: pr.repo,
            projectContext: agentProjects.find(p => p.name === pr.project)?.context,
            agentContext: agent.context,
          });

          reviewResults.push({ name: pr.project, approved: reviewResult.approved });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`  ⚠️ Review failed for ${pr.project}: ${msg}`));
          reviewResults.push({ name: pr.project, approved: false });
        }
      }
    } else {
      // Local review
      for (const proj of agentProjects) {
        try {
          const reviewer = createReviewerAgent({
            boardProvider: terminalBoard,
            aiProvider,
            workflow: config.workflow,
          });

          const reviewResult = await reviewer.processCardForLocalReview({
            card,
            projectPath: proj.path || process.cwd(),
            baseBranch: proj.baseBranch || 'main',
            projectContext: proj.context,
            agentContext: agent.context,
          });

          reviewResults.push({ name: proj.name, approved: reviewResult.approved });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`  ⚠️ Review failed for ${proj.name}: ${msg}`));
          reviewResults.push({ name: proj.name, approved: false });
        }
      }
    }

    // Show review summary
    reviewSpinner.stop();
    const allApproved = reviewResults.length === 0 || reviewResults.every(r => r.approved);
    if (allApproved) {
      console.log(chalk.green('  ✅ All reviews passed'));
    } else {
      for (const r of reviewResults) {
        if (!r.approved) {
          console.log(chalk.red(`  ❌ ${r.name} — review failed`));
        }
      }
    }
  }

  // Clean up interactive watcher
  if (askWatcherCleanup) {
    askWatcherCleanup();
  }
  if (askDir && existsSync(askDir)) {
    rmSync(askDir, { recursive: true, force: true });
  }

  // --- Final summary ---
  const totalDuration = Math.round((Date.now() - startTime) / 1000);
  console.log();
  if (result.success) {
    console.log(chalk.green.bold(`  ✅ Task completed (${totalDuration}s)`));
  } else {
    console.log(chalk.red.bold(`  ❌ Task failed (${totalDuration}s)`));
    if (result.error) {
      console.log(chalk.red(`  ${result.error}`));
    }
  }

  if (prUrls.length > 0) {
    console.log();
    console.log(chalk.bold('  Pull Requests:'));
    for (const pr of prUrls) {
      console.log(`  - ${pr.project}: ${chalk.cyan(pr.prUrl)}`);
    }
  }

  console.log();
}

/**
 * Watch the ask directory for questions from the MCP server.
 * When a .comment file appears with a question, prompt the user in the terminal
 * and write their answer as a .answer file.
 */
function startAskWatcher(askDir: string): () => void {
  const seenFiles = new Set<string>();
  let stopped = false;

  const poll = async () => {
    while (!stopped) {
      try {
        if (existsSync(askDir)) {
          const files = readdirSync(askDir).filter(f => f.endsWith('.comment'));

          for (const file of files) {
            if (seenFiles.has(file)) continue;
            seenFiles.add(file);

            // Read the comment
            const filePath = join(askDir, file);
            const data = JSON.parse(readFileSync(filePath, 'utf-8'));
            const text: string = data.text;

            // Check if this is a question (from ask_human tool)
            if (text.includes('Question from AI:')) {
              // Extract the question text
              const questionText = text
                .replace(/🤖\s*Question from AI:\s*/g, '')
                .replace(/---[\s\S]*$/, '')
                .trim();

              console.log();
              console.log(chalk.yellow('  🤖 AI is asking:'));
              console.log(chalk.bold(`  ${questionText}`));
              console.log();

              // Read answer from user
              const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
              const answer = await new Promise<string>((resolve) => {
                rl.question(chalk.cyan('  Your answer: '), (ans) => {
                  rl.close();
                  resolve(ans);
                });
              });

              // Write answer file
              const answerId = file.replace('.comment', '');
              const answerPath = join(askDir, `${answerId}.answer`);
              writeFileSync(answerPath, JSON.stringify({
                id: `answer-${answerId}`,
                text: `Answer: ${answer}`,
                authorName: 'Human',
                createdAt: new Date().toISOString(),
              }));
            } else {
              // Regular update — just print it
              const clean = text.replace(/\*\*(.+?)\*\*/g, '$1');
              console.log(chalk.dim('  │ ') + clean.split('\n').join('\n' + chalk.dim('  │ ')));
            }
          }
        }
      } catch {
        // Ignore poll errors
      }

      await new Promise(r => setTimeout(r, 500));
    }
  };

  // Start polling in background
  poll();

  // Return cleanup function
  return () => { stopped = true; };
}

function listAgents(): void {
  if (!isInitialized()) {
    ui.error('Boatclaw is not configured.');
    ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
    return;
  }

  const existingAgents = configManager.getRoles();
  const agentList = Object.values(existingAgents);

  console.log();
  console.log(chalk.bold('  Agents'));
  console.log(chalk.dim(`  ${agentList.length} agent(s) configured`));
  console.log();

  if (agentList.length === 0) {
    ui.dim('  No agents configured.');
    console.log();
    ui.actions([
      { cmd: 'boatclaw agents add', desc: 'Add a new agent' },
    ]);
    return;
  }

  for (let i = 0; i < agentList.length; i++) {
    const agent = agentList[i];
    const isLast = i === agentList.length - 1;
    const prefix = isLast ? '└─' : '├─';
    const linePrefix = isLast ? '  ' : '│ ';

    const statusIcon = agent.enabled ? chalk.green('●') : chalk.dim('○');
    const statusText = agent.enabled ? chalk.green('Active') : chalk.dim('Disabled');
    const labels = agent.labels?.join(', ') || agent.label || 'none';

    console.log('  ' + chalk.cyan(prefix) + ' ' + statusIcon + ' ' + chalk.bold(agent.name) + '  ' + statusText);
    console.log('  ' + chalk.cyan(linePrefix) + '   Labels   ' + chalk.white(labels));

    const projectScope = agent.projects?.includes('*')
      ? 'All projects'
      : agent.projects?.join(', ') || 'none';
    console.log('  ' + chalk.cyan(linePrefix) + '   Scope    ' + chalk.dim(projectScope));
    console.log('  ' + chalk.cyan(linePrefix) + '   Model    ' + chalk.dim(agent.model));

    if (agent.context || agent.contextFile) {
      const contextSource = agent.context ? '✓ Set' : `✓ From file: ${agent.contextFile}`;
      console.log('  ' + chalk.cyan(linePrefix) + '   Context  ' + chalk.green(contextSource));
    }

    if (!isLast) console.log('  ' + chalk.cyan('│'));
  }

  ui.actions([
    { cmd: 'boatclaw agents add', desc: 'Add a new agent' },
    { cmd: 'boatclaw agents ask <name>', desc: 'Chat with an agent' },
    { cmd: 'boatclaw agents show <name>', desc: 'View agent details' },
    { cmd: 'boatclaw agents remove <name>', desc: 'Remove an agent' },
    { cmd: 'boatclaw agents enable <name>', desc: 'Enable an agent' },
    { cmd: 'boatclaw agents disable <name>', desc: 'Disable an agent' },
    { cmd: 'boatclaw agents context <name>', desc: 'Edit agent context' },
    { cmd: 'boatclaw agents scope <name>', desc: 'Change project scope' },
  ]);
}
