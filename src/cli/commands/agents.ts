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
 * - agents ask <name>: Interactive chat with an agent
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { configManager, type RoleConfig } from '../../core/config.js';
import { isInitialized } from '../../core/paths.js';
import * as ui from '../ui.js';

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
      ui.keyValue('Context', agent.context ? chalk.green('✓ Set') : chalk.dim('Not set'));
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

      // Show context if exists
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

  // Ask agent (interactive chat)
  agents
    .command('ask <name>')
    .description('Start interactive chat with an agent')
    .option('-p, --project <project>', 'Project context to use')
    .action(async (name: string, options: { project?: string }) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
        return;
      }

      await askAgent(name, options.project);
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
  const { labelInput } = await inquirer.prompt([{
    type: 'input',
    name: 'labelInput',
    message: 'Card label to match:',
    default: normalizedName,
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
    context = await inputContextInline('Enter agent context (coding style, preferences):');
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
      const newText = await inputContextInline('Enter agent context (coding style, preferences):');
      if (newText) {
        agent.context = newText;
        configManager.setRole(name, agent);
        ui.success('Context saved');
      }
    }
  }
}

/**
 * Simple inline text input for context.
 */
async function inputContextInline(prompt: string): Promise<string> {
  console.log();
  console.log(chalk.bold('  ' + prompt));
  console.log(chalk.dim('  Type your text. Press Enter for new line. Empty line to finish.'));
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
        rl.close();
        const result = lines.join('\n').trim();
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

async function askAgent(name: string, projectName?: string): Promise<void> {
  const existingAgents = configManager.getRoles();

  if (!(name in existingAgents)) {
    ui.error(`Agent "${name}" not found.`);
    const available = Object.keys(existingAgents);
    if (available.length > 0) {
      ui.info('Available agents: ' + available.join(', '));
    }
    return;
  }

  const agent = existingAgents[name];
  const projects = configManager.getProjects();
  const projectList = Object.values(projects);

  // Determine which project to use
  let project = projectName ? projects[projectName] : undefined;

  if (projectName && !project) {
    ui.error(`Project "${projectName}" not found.`);
    return;
  }

  // If no project specified, determine from agent's scope or ask
  if (!project) {
    if (agent.projects && !agent.projects.includes('*')) {
      // Agent has specific project scope - use first one
      const firstProject = agent.projects[0];
      if (firstProject && projects[firstProject]) {
        project = projects[firstProject];
      }
    } else if (projectList.length === 1) {
      // Only one project - use it
      project = projectList[0];
    } else if (projectList.length > 1) {
      // Multiple projects - ask user to select
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select project to work in:',
        choices: projectList.map((p) => ({ name: `${p.name} (${p.path})`, value: p.name })),
      }]);
      project = projects[selected];
    }
  }

  // Use project path or current directory
  const projectPath = project?.path || process.cwd();

  // Build context from agent + project
  const contextParts: string[] = [];

  if (agent.context) {
    contextParts.push(`Agent context (${agent.name}):\n${agent.context}`);
  }

  if (project?.context) {
    contextParts.push(`Project context (${project.name}):\n${project.context}`);
  }

  const fullContext = contextParts.join('\n\n---\n\n');

  // Get provider (agent's provider or default)
  const provider = agent.provider || configManager.get<string>('ai.provider') || 'claude';

  console.log();
  console.log(chalk.cyan('  ┌' + '─'.repeat(50) + '┐'));
  console.log(chalk.cyan('  │') + chalk.bold(` Chat with ${agent.name}`.padEnd(50)) + chalk.cyan('│'));
  console.log(chalk.cyan('  │') + chalk.dim(` Provider: ${provider}, Model: ${agent.model}`.padEnd(50)) + chalk.cyan('│'));
  if (project) {
    console.log(chalk.cyan('  │') + chalk.dim(` Project: ${project.name}`.padEnd(50)) + chalk.cyan('│'));
  }
  console.log(chalk.cyan('  │') + chalk.dim(` Path: ${projectPath}`.slice(0, 51).padEnd(50)) + chalk.cyan('│'));
  const hasContext = agent.context || project?.context;
  console.log(chalk.cyan('  │') + chalk.dim(` Context: ${hasContext ? '✓ Loaded' : 'None'}`.padEnd(50)) + chalk.cyan('│'));
  console.log(chalk.cyan('  └' + '─'.repeat(50) + '┘'));
  console.log();

  // Spawn Claude CLI
  const cliCommand = provider === 'cursor' ? 'cursor' : 'claude';

  // Build command args
  const args: string[] = [];

  // Add model if not auto
  if (agent.model && agent.model !== 'auto') {
    args.push('--model', agent.model);
  }

  // Add system prompt with context
  if (fullContext) {
    args.push('--system-prompt', fullContext);
  }

  // Spawn interactive session
  const child = spawn(cliCommand, args, {
    cwd: projectPath,
    stdio: 'inherit',
    shell: true,
  });

  child.on('error', (err) => {
    if (err.message.includes('ENOENT')) {
      ui.error(`${cliCommand} CLI not found. Please install it first.`);
      if (provider === 'claude') {
        ui.info('Install Claude Code: https://claude.ai/code');
      }
    } else {
      ui.error(`Failed to start ${cliCommand}: ${err.message}`);
    }
  });

  child.on('close', (code) => {
    console.log();
    if (code === 0) {
      ui.success('Chat session ended');
    }
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  // Wait for the child process to finish
  await new Promise<void>((resolve) => {
    child.on('close', () => resolve());
  });
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

    if (agent.context) {
      console.log('  ' + chalk.cyan(linePrefix) + '   Context  ' + chalk.green('✓ Set'));
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
  ]);
}
