/**
 * Context management commands.
 *
 * Context is stored directly in the config file (~/.boatclaw/config.yaml)
 * No external files - everything managed through the terminal.
 *
 * Commands:
 * - context: Show all context
 * - context project <name>: View/edit project context
 * - context agent <name>: View/edit agent context
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as readline from 'readline';
import { configManager } from '../../core/config.js';
import * as ui from '../ui.js';

export function registerContextCommands(program: Command): void {
  const context = program
    .command('context')
    .description('Manage context for projects and agents');

  // Default action - list all context
  context.action(() => {
    listContext();
  });

  // Project context
  context
    .command('project <name>')
    .description('View or edit project context')
    .action(async (name: string) => {
      await editProjectContext(name);
    });

  // Agent context
  context
    .command('agent <name>')
    .description('View or edit agent context')
    .action(async (name: string) => {
      await editAgentContext(name);
    });

  // Clear context
  context
    .command('clear <type> <name>')
    .description('Clear context (type: project or agent)')
    .action(async (type: string, name: string) => {
      await clearContext(type, name);
    });
}

function listContext(): void {
  const projects = configManager.getProjects();
  const agents = configManager.getRoles();
  const projectList = Object.values(projects);
  const agentList = Object.values(agents);

  console.log();
  console.log(chalk.bold('  Context'));
  console.log(chalk.dim('  Context helps AI understand your projects and coding preferences'));
  console.log();

  // Project contexts
  console.log('  ' + chalk.cyan('┌─') + chalk.bold(' Projects'));
  console.log('  ' + chalk.cyan('│'));

  if (projectList.length === 0) {
    console.log('  ' + chalk.cyan('│') + chalk.dim('  No projects configured'));
  } else {
    for (const project of projectList) {
      const hasContext = !!project.context;
      const statusIcon = hasContext ? chalk.green('✓') : chalk.dim('○');
      const preview = hasContext
        ? chalk.dim(' "' + project.context!.slice(0, 30).replace(/\n/g, ' ') + (project.context!.length > 30 ? '...' : '') + '"')
        : chalk.dim(' (empty)');
      console.log('  ' + chalk.cyan('│') + '  ' + statusIcon + ' ' + chalk.white(project.name) + preview);
    }
  }

  console.log('  ' + chalk.cyan('│'));

  // Agent contexts
  console.log('  ' + chalk.cyan('└─') + chalk.bold(' Agents'));
  console.log('    ');

  if (agentList.length === 0) {
    console.log('    ' + chalk.dim('  No agents configured'));
  } else {
    for (const agent of agentList) {
      const hasContext = !!agent.context;
      const statusIcon = hasContext ? chalk.green('✓') : chalk.dim('○');
      const preview = hasContext
        ? chalk.dim(' "' + agent.context!.slice(0, 30).replace(/\n/g, ' ') + (agent.context!.length > 30 ? '...' : '') + '"')
        : chalk.dim(' (empty)');
      console.log('    ' + '  ' + statusIcon + ' ' + chalk.white(agent.name) + preview);
    }
  }

  ui.actions([
    { cmd: 'boatclaw context project <name>', desc: 'Edit project context' },
    { cmd: 'boatclaw context agent <name>', desc: 'Edit agent context' },
    { cmd: 'boatclaw context clear <type> <name>', desc: 'Clear context' },
  ]);
}

async function editProjectContext(name: string): Promise<void> {
  const project = configManager.getProject(name);

  if (!project) {
    ui.error(`Project "${name}" not found.`);
    const projects = Object.keys(configManager.getProjects());
    if (projects.length > 0) {
      console.log();
      ui.dim('Available projects: ' + projects.join(', '));
    }
    return;
  }

  console.log();
  console.log(chalk.bold(`  Project: ${name}`));
  console.log();

  // Show current context
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

    const newText = await inputContext(action === 'edit' ? 'Enter new context:' : 'Add more context:');

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
      const newText = await inputContext('Enter project context (tech stack, structure, conventions):');
      if (newText) {
        project.context = newText;
        configManager.setProject(name, project);
        ui.success('Context saved');
      }
    }
  }
}

async function editAgentContext(name: string): Promise<void> {
  const agents = configManager.getRoles();
  const agent = agents[name];

  if (!agent) {
    ui.error(`Agent "${name}" not found.`);
    const agentNames = Object.keys(agents);
    if (agentNames.length > 0) {
      console.log();
      ui.dim('Available agents: ' + agentNames.join(', '));
    }
    return;
  }

  console.log();
  console.log(chalk.bold(`  Agent: ${name}`));
  console.log();

  // Show current context
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

    const newText = await inputContext(action === 'edit' ? 'Enter new context:' : 'Add more context:');

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
      const newText = await inputContext('Enter agent context (coding style, preferences):');
      if (newText) {
        agent.context = newText;
        configManager.setRole(name, agent);
        ui.success('Context saved');
      }
    }
  }
}

async function clearContext(type: string, name: string): Promise<void> {
  if (type !== 'project' && type !== 'agent') {
    ui.error('Type must be "project" or "agent"');
    return;
  }

  if (type === 'project') {
    const project = configManager.getProject(name);
    if (!project) {
      ui.error(`Project "${name}" not found.`);
      return;
    }

    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: `Clear context for project "${name}"?`,
      default: false,
    }]);

    if (confirmed) {
      project.context = undefined;
      configManager.setProject(name, project);
      ui.success('Context cleared');
    }
  } else {
    const agents = configManager.getRoles();
    const agent = agents[name];
    if (!agent) {
      ui.error(`Agent "${name}" not found.`);
      return;
    }

    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: `Clear context for agent "${name}"?`,
      default: false,
    }]);

    if (confirmed) {
      agent.context = undefined;
      configManager.setRole(name, agent);
      ui.success('Context cleared');
    }
  }
}

/**
 * Simple inline text input.
 * Type text, press Enter for new lines, empty line to finish.
 */
async function inputContext(prompt: string): Promise<string> {
  console.log();
  console.log(chalk.bold('  ' + prompt));
  console.log(chalk.dim('  Type your text. Press Enter for new line. Empty line to finish.'));
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
        // Empty line after content = done
        rl.close();
        const result = lines.join('\n').trim();
        console.log(chalk.cyan('  ─'.repeat(25)));
        resolve(result);
        return;
      }

      if (line !== '' || lines.length > 0) {
        lines.push(line);
      }
      rl.prompt();
    });

    rl.on('close', () => {
      const result = lines.join('\n').trim();
      resolve(result);
    });
  });
}
