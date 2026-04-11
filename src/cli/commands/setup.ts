/**
 * Setup wizard command for Boatclaw.
 *
 * Interactive setup flow:
 * 1. Select platform (Trello, Jira, Linear)
 * 2. Configure platform credentials
 * 3. Select board/project
 * 4. Configure workflow (lists/columns)
 * 5. Add initial role
 * 6. Configure AI provider
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { configManager, Platform, type RoleConfig, type ProjectConfig } from '../../core/config.js';
import { ensureDirs, isInitialized } from '../../core/paths.js';
import { TrelloProvider } from '../../platforms/trello.js';
import * as ui from '../ui.js';
import { selectPath, detectGitHubRepo, isGitRepo, getDefaultBranch, inputMultilineText } from '../prompts.js';
import { existsSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive setup wizard')
    .option('--reset', 'Reset existing configuration')
    .action(async (options: { reset?: boolean }) => {
      ui.showLogo();

      // Check for existing config
      if (isInitialized() && !options.reset) {
        const { proceed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: 'Configuration already exists. Do you want to reconfigure?',
            default: false,
          },
        ]);

        if (!proceed) {
          ui.info('Setup cancelled. Use "boatclaw status" to see current config.');
          return;
        }
      }

      ensureDirs();

      try {
        // Step 1: Platform selection
        await setupPlatform();

        // Step 2: Workflow configuration
        await setupWorkflow();

        // Step 3: AI provider (needed before agent setup for model selection)
        await setupAI();

        // Step 4: Add a project
        await setupInitialProject();

        // Step 5: Add an agent
        await setupInitialAgent();

        // Step 6: GitHub (optional)
        await setupGitHub();

        // Summary
        showSummary();
      } catch (error) {
        if (error instanceof Error && error.message === 'prompt cancelled') {
          ui.warning('\nSetup cancelled.');
          return;
        }
        throw error;
      }
    });
}

async function setupPlatform(): Promise<void> {
  ui.header('STEP 1 · Platform');

  const { platform } = await inquirer.prompt([
    {
      type: 'list',
      name: 'platform',
      message: 'Which platform do you use?',
      choices: [
        { name: 'Trello', value: 'trello' },
        { name: 'Jira (coming soon)', value: 'jira', disabled: true },
        { name: 'Linear (coming soon)', value: 'linear', disabled: true },
      ],
    },
  ]);

  configManager.set('platform', platform);

  // Platform-specific setup
  switch (platform as Platform) {
    case 'trello':
      await setupTrello();
      break;
    case 'jira':
      await setupJira();
      break;
    case 'linear':
      await setupLinear();
      break;
  }
}

async function setupTrello(): Promise<void> {
  ui.infoBox([
    'Get your Trello API credentials:',
    '',
    '1. Go to: https://trello.com/app-key',
    '2. Copy your API Key',
    '3. Click "Generate a Token" link',
    '4. Copy the generated token',
  ]);

  const credentials = await inquirer.prompt([
    {
      type: 'input',
      name: 'apiKey',
      message: 'Trello API Key:',
      validate: (input: string) => input.length > 0 || 'API key is required',
    },
    {
      type: 'password',
      name: 'apiToken',
      message: 'Trello API Token:',
      mask: '*',
      validate: (input: string) => input.length > 0 || 'API token is required',
    },
  ]);

  // Verify credentials
  const spinner = ui.spinner('Verifying credentials...').start();

  // Create a temporary provider to fetch boards
  const tempProvider = new TrelloProvider({
    apiKey: credentials.apiKey,
    apiToken: credentials.apiToken,
    boardId: 'me', // Will be replaced
  });

  try {
    // Fetch user's boards
    const axios = await import('axios');
    const response = await axios.default.get(
      `https://api.trello.com/1/members/me/boards`,
      {
        params: {
          key: credentials.apiKey,
          token: credentials.apiToken,
          fields: 'id,name,url',
          filter: 'open',
        },
      }
    );

    spinner.succeed('Credentials verified!');

    const boards = response.data as Array<{ id: string; name: string; url: string }>;

    if (boards.length === 0) {
      ui.error('No boards found. Create a board on Trello first.');
      process.exit(1);
    }

    // Let user select a board
    ui.blank();
    const { boardId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'boardId',
        message: 'Select your board:',
        choices: boards.map((board) => ({
          name: `${board.name}`,
          value: board.id,
        })),
      },
    ]);

    const selectedBoard = boards.find((b) => b.id === boardId)!;

    // Save configuration
    configManager.set('trello.apiKey', credentials.apiKey);
    configManager.set('trello.apiToken', credentials.apiToken);
    configManager.set('trello.boardId', boardId);
    configManager.set('trello.boardName', selectedBoard.name);

    ui.success(`Board "${selectedBoard.name}" selected!`);
  } catch (error) {
    spinner.fail('Failed to verify credentials');
    if (error instanceof Error) {
      ui.error(error.message);
    }
    throw error;
  }
}

async function setupJira(): Promise<void> {
  ui.error('Jira integration coming soon. Please use Trello for now.');
  process.exit(1);
}

async function setupLinear(): Promise<void> {
  ui.error('Linear integration coming soon. Please use Trello for now.');
  process.exit(1);
}

async function setupWorkflow(): Promise<void> {
  ui.header('STEP 2 · Workflow');

  ui.dim('Configure which lists Boatclaw should use.');
  ui.dim('Cards will flow: Trigger → Working → Success/Failed');
  ui.blank();

  const platform = configManager.get<Platform>('platform');

  if (platform === 'trello') {
    await setupTrelloWorkflow();
  } else {
    // Fallback to manual entry for other platforms
    await setupManualWorkflow();
  }
}

async function setupTrelloWorkflow(): Promise<void> {
  const config = configManager.load();
  const spinner = ui.spinner('Fetching lists...').start();

  try {
    const provider = new TrelloProvider({
      apiKey: config.trello.apiKey,
      apiToken: config.trello.apiToken,
      boardId: config.trello.boardId,
    });

    const lists = await provider.getLists();
    await provider.close();

    spinner.succeed('Lists fetched!');

    if (lists.length === 0) {
      ui.error('No lists found on this board. Add some lists first.');
      process.exit(1);
    }

    console.log();

    // Create choices for lists
    const listChoices = lists.map((list) => ({
      name: list.name,
      value: list.id,
    }));

    const noneChoice = { name: '(none)', value: '' };

    // Trigger list
    const { triggerId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'triggerId',
        message: 'Trigger list (cards to pick up):',
        choices: listChoices,
      },
    ]);

    // Working list
    const { workingId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'workingId',
        message: 'Working list (tasks in progress):',
        choices: listChoices.filter((c) => c.value !== triggerId),
      },
    ]);

    // Success list
    const { successId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'successId',
        message: 'Success list (completed tasks):',
        choices: listChoices.filter(
          (c) => c.value !== triggerId && c.value !== workingId
        ),
      },
    ]);

    // Review list (optional)
    const remainingForReview = listChoices.filter(
      (c) =>
        c.value !== triggerId &&
        c.value !== workingId &&
        c.value !== successId
    );

    let reviewId = '';
    if (remainingForReview.length > 0) {
      const { reviewChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'reviewChoice',
          message: 'Review list (optional, before success):',
          choices: [noneChoice, ...remainingForReview],
        },
      ]);
      reviewId = reviewChoice;
    }

    // Failed list (optional)
    const remainingForFailed = listChoices.filter(
      (c) =>
        c.value !== triggerId &&
        c.value !== workingId &&
        c.value !== successId &&
        c.value !== reviewId
    );

    let failedId = '';
    if (remainingForFailed.length > 0) {
      const { failedChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'failedChoice',
          message: 'Failed list (optional):',
          choices: [noneChoice, ...remainingForFailed],
        },
      ]);
      failedId = failedChoice;
    }

    // Get list names for display
    const getListName = (id: string) =>
      lists.find((l) => l.id === id)?.name || '';

    // Save workflow config
    configManager.set('workflow.triggerId', triggerId);
    configManager.set('workflow.triggerName', getListName(triggerId));
    configManager.set('workflow.workingId', workingId);
    configManager.set('workflow.workingName', getListName(workingId));
    configManager.set('workflow.reviewId', reviewId);
    configManager.set('workflow.reviewName', reviewId ? getListName(reviewId) : '');
    configManager.set('workflow.successId', successId);
    configManager.set('workflow.successName', getListName(successId));
    configManager.set('workflow.failedId', failedId);
    configManager.set('workflow.failedName', failedId ? getListName(failedId) : '');

    ui.success('Workflow configured!');

    // Show flow visualization
    ui.blank();
    const flowSteps = [getListName(triggerId), getListName(workingId)];
    if (reviewId) flowSteps.push(getListName(reviewId));
    flowSteps.push(getListName(successId));
    ui.flow(flowSteps);
    if (failedId) {
      ui.dim(`Failed tasks → ${getListName(failedId)}`);
    }
  } catch (error) {
    spinner.fail('Failed to fetch lists');
    throw error;
  }
}

async function setupManualWorkflow(): Promise<void> {
  const platform = configManager.get<Platform>('platform');
  const listLabel = platform === 'trello' ? 'list' : 'column/status';

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'triggerId',
      message: `Trigger ${listLabel} ID (tasks to pick up):`,
      validate: (input: string) => input.length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'workingId',
      message: `Working ${listLabel} ID (tasks in progress):`,
      validate: (input: string) => input.length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'reviewId',
      message: `Review ${listLabel} ID (optional):`,
      default: '',
    },
    {
      type: 'input',
      name: 'successId',
      message: `Success ${listLabel} ID (completed tasks):`,
      validate: (input: string) => input.length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'failedId',
      message: `Failed ${listLabel} ID (optional):`,
      default: '',
    },
  ]);

  configManager.set('workflow.triggerId', answers.triggerId);
  configManager.set('workflow.workingId', answers.workingId);
  configManager.set('workflow.reviewId', answers.reviewId || '');
  configManager.set('workflow.successId', answers.successId);
  configManager.set('workflow.failedId', answers.failedId || '');

  ui.success('Workflow configured!');
}

async function setupInitialProject(): Promise<void> {
  ui.header('STEP 4 · Project');

  ui.dim('Add a repository for agents to work on.');
  ui.blank();

  const { addProject } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addProject',
      message: 'Would you like to add a project now?',
      default: true,
    },
  ]);

  if (!addProject) {
    ui.info('You can add projects later with "boatclaw projects add"');
    return;
  }

  // Use folder browser
  console.log(chalk.dim('Navigate to select your project folder:'));
  const repoPath = await selectPath({
    message: 'Project folder:',
    startPath: process.cwd(),
    onlyDirectories: true,
  });

  const resolvedPath = resolve(repoPath);

  // Project name - default to folder name
  const defaultName = basename(resolvedPath).toLowerCase().replace(/\s+/g, '-');
  const { name } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      default: defaultName,
      validate: (input: string) => input.length > 0 || 'Name is required',
    },
  ]);

  // Auto-detect GitHub
  let github: string | undefined;
  if (isGitRepo(resolvedPath)) {
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

  // Auto-detect base branch
  let baseBranch = 'main';
  if (isGitRepo(resolvedPath)) {
    baseBranch = getDefaultBranch(resolvedPath);
  }

  // Context - ask if they want to add now
  let contextFile: string | undefined;
  const contextPath = resolve(resolvedPath, 'CONTEXT.md');

  if (existsSync(contextPath)) {
    ui.info('Found CONTEXT.md in project folder.');
    contextFile = 'CONTEXT.md';
  } else {
    const { addContext } = await inquirer.prompt([{
      type: 'confirm',
      name: 'addContext',
      message: 'Add context for this project? (tech stack, coding style, etc.)',
      default: false,
    }]);

    if (addContext) {
      const contextText = await inputMultilineText({
        message: 'Project Context',
        hint: 'Describe the project: tech stack, structure, coding conventions, etc.',
      });

      if (contextText) {
        contextFile = 'CONTEXT.md';
        writeFileSync(contextPath, contextText);
        ui.success('Context saved to CONTEXT.md');
      }
    }
  }

  // Save project
  const project: ProjectConfig = {
    name,
    path: resolvedPath,
    github,
    contextFile,
    baseBranch,
    branchPrefix: 'feature/',
  };

  configManager.setProject(name, project);
  ui.success(`Project "${name}" added!`);
}

async function setupInitialAgent(): Promise<void> {
  ui.header('STEP 5 · Agent');

  ui.dim('Agents are AI workers that pick up tasks from your board.');
  ui.blank();

  // Fetch available labels from Trello
  const config = configManager.load();
  let availableLabels: Array<{ id: string; name: string; color: string }> = [];

  if (config.platform === 'trello') {
    const spinner = ui.spinner('Fetching labels...').start();
    try {
      const provider = new TrelloProvider({
        apiKey: config.trello.apiKey,
        apiToken: config.trello.apiToken,
        boardId: config.trello.boardId,
      });
      const labels = await provider.getLabels();
      availableLabels = labels.filter((l) => l.name).map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color || '',
      }));
      await provider.close();
      spinner.succeed(`Found ${availableLabels.length} labels`);
    } catch {
      spinner.warn('Could not fetch labels');
    }
  }

  const { addAgent } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addAgent',
      message: 'Would you like to add an agent now?',
      default: true,
    },
  ]);

  if (!addAgent) {
    ui.info('You can add agents later with "boatclaw agents add"');
    return;
  }

  // Agent name
  const { name } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Agent name (e.g., alice, backend-dev):',
      validate: (input: string) => input.length > 0 || 'Name is required',
      filter: (input: string) => input.toLowerCase().replace(/\s+/g, '-'),
    },
  ]);

  // Label selection
  let label: string;
  if (availableLabels.length > 0) {
    const { labelChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'labelChoice',
        message: 'Select a label to match:',
        choices: [
          ...availableLabels.map((l) => ({
            name: `${l.name} (${l.color || 'no color'})`,
            value: l.name,
          })),
          { name: '(enter custom)', value: '__custom__' },
        ],
      },
    ]);

    if (labelChoice === '__custom__') {
      const { customLabel } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customLabel',
          message: 'Enter label name:',
          validate: (input: string) => input.length > 0 || 'Label is required',
        },
      ]);
      label = customLabel;
    } else {
      label = labelChoice;
    }
  } else {
    const { manualLabel } = await inquirer.prompt([
      {
        type: 'input',
        name: 'manualLabel',
        message: 'Label to match (exact match on card labels):',
        validate: (input: string) => input.length > 0 || 'Label is required',
      },
    ]);
    label = manualLabel;
  }

  // Provider selection (if multiple available)
  const availableProviders = configManager.get<string[]>('ai.availableProviders') || [configManager.get<string>('ai.provider') || 'claude'];
  let provider: string | undefined;

  if (availableProviders.length > 1) {
    const { providerChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'providerChoice',
        message: 'AI provider for this agent:',
        choices: availableProviders.map((p) => ({
          name: p === 'claude' ? 'Claude CLI' : 'Cursor CLI',
          value: p,
        })),
      },
    ]);
    provider = providerChoice;
  }

  // Model selection
  const { model } = await inquirer.prompt([
    {
      type: 'list',
      name: 'model',
      message: 'Preferred AI model:',
      choices: [
        { name: 'Sonnet (recommended)', value: 'sonnet' },
        { name: 'Haiku (fast, simple tasks)', value: 'haiku' },
        { name: 'Opus (complex tasks)', value: 'opus' },
        { name: 'Auto (smart selection)', value: 'auto' },
      ],
      default: 'sonnet',
    },
  ]);

  // Context for agent
  let contextFile: string | undefined;
  const { addContext } = await inquirer.prompt([{
    type: 'confirm',
    name: 'addContext',
    message: 'Add context for this agent? (coding style, preferences)',
    default: false,
  }]);

  if (addContext) {
    const contextText = await inputMultilineText({
      message: 'Agent Context',
      hint: 'Describe how this agent should work (coding style, preferences, etc.)',
    });

    if (contextText) {
      const projects = configManager.getProjects();
      const firstProject = Object.values(projects)[0];
      const basePath = firstProject?.path || process.cwd();
      contextFile = `agents/${name}.md`;
      const contextPath = resolve(basePath, contextFile);

      // Ensure directory exists
      const { mkdirSync } = await import('fs');
      const { dirname } = await import('path');
      const dir = dirname(contextPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(contextPath, contextText);
      ui.success(`Context saved to: ${contextFile}`);
    }
  }

  const agent: RoleConfig = {
    name,
    labels: [label],
    projects: ['*'],
    provider: provider as 'claude' | 'cursor' | undefined,
    model,
    enabled: true,
    contextFile,
  };

  configManager.setRole(name, agent);
  ui.success(`Agent "${name}" added!`);
  if (provider) {
    ui.dim(`Provider: ${provider}`);
  }
}

async function setupGitHub(): Promise<void> {
  ui.header('STEP 6 · GitHub');

  ui.dim('Enable automatic PR creation for completed tasks.');
  ui.blank();

  const { enableGitHub } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableGitHub',
      message: 'Enable GitHub PR creation?',
      default: true,
    },
  ]);

  if (!enableGitHub) {
    configManager.set('github.enabled', false);
    ui.info('GitHub disabled. Agents will make local changes only.');
    return;
  }

  ui.infoBox([
    'Create a GitHub Personal Access Token:',
    '',
    '1. Go to: https://github.com/settings/tokens',
    '2. Generate new token (classic)',
    '3. Select scope: repo (full control)',
  ]);

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'GitHub Personal Access Token:',
      mask: '*',
      validate: (input: string) => {
        if (!input) return 'Token is required for GitHub integration';
        if (!input.startsWith('ghp_') && !input.startsWith('github_pat_')) {
          return 'Token should start with ghp_ or github_pat_';
        }
        return true;
      },
    },
  ]);

  configManager.set('github.enabled', true);
  configManager.set('github.token', token);
  configManager.set('github.createPrs', true);

  ui.success('GitHub integration enabled!');
}

async function setupAI(): Promise<void> {
  ui.header('STEP 3 · AI Provider');

  ui.dim('Select the AI CLI(s) you have installed.');
  ui.blank();

  const { providers } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'providers',
      message: 'Which AI CLI(s) do you have installed?',
      choices: [
        { name: 'Claude CLI (claude)', value: 'claude', checked: true },
        { name: 'Cursor CLI (cursor)', value: 'cursor' },
      ],
      validate: (input: string[]) => input.length > 0 || 'Select at least one provider',
    },
  ]);

  // Set default provider (first selected)
  const defaultProvider = providers[0];
  configManager.set('ai.provider', defaultProvider);
  configManager.set('ai.availableProviders', providers);
  configManager.set('ai.defaultModel', 'auto');

  // Set poll interval
  configManager.set('worker.pollInterval', 3); // 3 seconds

  if (providers.length > 1) {
    ui.success(`AI providers configured: ${providers.join(', ')}`);
    ui.dim('You can assign different providers to different agents.');
  } else {
    ui.success(`AI provider configured: ${defaultProvider}`);
  }
}

function showSummary(): void {
  ui.divider();

  const config = configManager.load();
  const agents = Object.keys(config.roles);
  const projects = Object.keys(config.projects);

  ui.successBox('Setup Complete', [
    `Platform: ${config.platform || 'Not set'}`,
    `Board: ${config.trello?.boardName || config.trello?.boardId || 'Not set'}`,
    `Projects: ${projects.length > 0 ? projects.join(', ') : 'None'}`,
    `Agents: ${agents.length > 0 ? agents.join(', ') : 'None'}`,
    `GitHub: ${config.github.enabled ? 'Enabled' : 'Disabled'}`,
  ]);

  // Workflow visualization
  const flowSteps = [
    config.workflow.triggerName || 'Trigger',
    config.workflow.workingName || 'Working',
  ];
  if (config.workflow.reviewId) {
    flowSteps.push(config.workflow.reviewName || 'Review');
  }
  flowSteps.push(config.workflow.successName || 'Success');

  ui.section('Workflow');
  ui.flow(flowSteps);

  // Next steps
  ui.nextSteps([
    'Add cards to your trigger list with matching labels',
    `Run ${chalk.cyan('boatclaw start')} to begin processing`,
    `Run ${chalk.cyan('boatclaw status')} to check configuration`,
  ]);

  if (projects.length === 0) {
    ui.warning(`Add projects: ${chalk.cyan('boatclaw projects add')}`);
  }
  if (agents.length === 0) {
    ui.warning(`Add agents: ${chalk.cyan('boatclaw agents add')}`);
  }
  ui.blank();
}
