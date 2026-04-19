/**
 * Status and worker control commands.
 *
 * Commands:
 * - status: Show current configuration status
 * - start: Start the worker
 * - stop: Stop the worker
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { sep } from 'path';
import { configManager } from '../../core/config.js';
import { isInitialized, BOATCLAW_DIR, LOCK_FILE } from '../../core/paths.js';
import { createBoardProvider, verifyPlatformConfig, verifyWorkflowConfig } from '../../platforms/factory.js';
import { Worker, createWorker, TaskResult } from '../../core/worker.js';
import { Card } from '../../platforms/types.js';
import { RoleConfig } from '../../core/config.js';
import { createTaskProcessorFunction, checkAIAvailability } from '../../ai/index.js';
import * as ui from '../ui.js';

export function registerStatusCommands(program: Command): void {
  // Status command
  program
    .command('status')
    .description('Show current configuration and worker status')
    .action(async () => {
      ui.showLogo();

      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        console.log();
        ui.info(`Run ${chalk.cyan('boatclaw setup')} to get started.`);
        return;
      }

      const config = configManager.load();
      const projects = Object.values(config.projects);
      const agents = Object.values(config.roles);

      // ─────────────────────────────────────────
      // CONFIGURATION OVERVIEW
      // ─────────────────────────────────────────
      ui.header('Configuration');

      // Platform Section
      console.log('  ' + chalk.cyan('┌─') + chalk.bold(' Platform'));
      console.log('  ' + chalk.cyan('│'));
      if (config.platform === 'trello') {
        console.log('  ' + chalk.cyan('│') + '  Type       ' + chalk.white('Trello'));
        console.log('  ' + chalk.cyan('│') + '  Board      ' + chalk.white(config.trello.boardName || config.trello.boardId || 'Not set'));
      } else if (config.platform === 'jira') {
        console.log('  ' + chalk.cyan('│') + '  Type       ' + chalk.white('Jira'));
        console.log('  ' + chalk.cyan('│') + '  Project    ' + chalk.white(config.jira.projectKey || 'Not set'));
        console.log('  ' + chalk.cyan('│') + '  Instance   ' + chalk.dim(config.jira.instanceUrl || 'Not set'));
      } else if (config.platform === 'linear') {
        console.log('  ' + chalk.cyan('│') + '  Type       ' + chalk.white('Linear'));
        console.log('  ' + chalk.cyan('│') + '  Team       ' + chalk.white(config.linear.teamName || config.linear.teamId || 'Not set'));
      } else {
        console.log('  ' + chalk.cyan('│') + '  Type       ' + chalk.dim('Not configured'));
      }
      console.log('  ' + chalk.cyan('│'));

      // Workflow Section
      console.log('  ' + chalk.cyan('├─') + chalk.bold(' Workflow'));
      console.log('  ' + chalk.cyan('│'));
      const workflowSteps = [
        { label: 'Trigger', value: config.workflow.triggerName || config.workflow.triggerId, icon: '◯' },
        { label: 'Working', value: config.workflow.workingName || config.workflow.workingId, icon: '→' },
        { label: 'Review', value: config.workflow.reviewName || config.workflow.reviewId, icon: '◎', optional: true },
        { label: 'Success', value: config.workflow.successName || config.workflow.successId, icon: '✓' },
        { label: 'Failed', value: config.workflow.failedName || config.workflow.failedId, icon: '✗', optional: true },
      ];
      for (const step of workflowSteps) {
        if (step.optional && !step.value) continue;
        const iconColor = step.icon === '✓' ? chalk.green : step.icon === '✗' ? chalk.red : chalk.cyan;
        console.log('  ' + chalk.cyan('│') + '  ' + iconColor(step.icon) + ' ' + step.label.padEnd(10) + chalk.white(step.value || 'Not set'));
      }
      console.log('  ' + chalk.cyan('│'));

      // AI Provider Section
      console.log('  ' + chalk.cyan('├─') + chalk.bold(' AI Provider'));
      console.log('  ' + chalk.cyan('│'));
      console.log('  ' + chalk.cyan('│') + '  Provider   ' + chalk.white(config.ai.provider === 'claude' ? 'Claude CLI' : 'Cursor CLI'));
      console.log('  ' + chalk.cyan('│') + '  Model      ' + chalk.white(config.ai.defaultModel));
      console.log('  ' + chalk.cyan('│') + '  Timeout    ' + chalk.dim(`${config.ai.timeoutSeconds}s`));
      console.log('  ' + chalk.cyan('│'));

      // Worker Settings Section
      console.log('  ' + chalk.cyan('├─') + chalk.bold(' Worker'));
      console.log('  ' + chalk.cyan('│'));
      console.log('  ' + chalk.cyan('│') + '  Poll       ' + chalk.white(`${config.worker.pollInterval}s`));
      console.log('  ' + chalk.cyan('│') + '  Parallel   ' + chalk.white(`${config.worker.maxParallelTasks || 10} tasks max`));
      console.log('  ' + chalk.cyan('│'));

      // GitHub Section
      console.log('  ' + chalk.cyan('└─') + chalk.bold(' GitHub'));
      console.log('    ');
      if (config.github.enabled && config.github.token) {
        console.log('    ' + '  Status     ' + chalk.green('● Connected'));
        if (config.github.defaultRepo) {
          console.log('    ' + '  Repo       ' + chalk.white(config.github.defaultRepo));
        }
        console.log('    ' + '  PRs        ' + (config.github.createPrs ? chalk.green('Auto-create') : chalk.dim('Manual')));
      } else {
        console.log('    ' + '  Status     ' + chalk.dim('○ Not configured'));
        console.log('    ' + chalk.dim('  Run: boatclaw github setup'));
      }

      // ─────────────────────────────────────────
      // PROJECTS
      // ─────────────────────────────────────────
      console.log();
      ui.header('Projects');

      if (projects.length === 0) {
        console.log('  ' + chalk.dim('No projects configured'));
        console.log('  ' + chalk.dim(`Run ${chalk.cyan('boatclaw projects add')} to add one`));
      } else {
        for (let i = 0; i < projects.length; i++) {
          const project = projects[i];
          const isLast = i === projects.length - 1;
          const prefix = isLast ? '└─' : '├─';
          const linePrefix = isLast ? '  ' : '│ ';

          console.log('  ' + chalk.cyan(prefix) + ' ' + chalk.bold(project.name));
          console.log('  ' + chalk.cyan(linePrefix) + '   Path     ' + chalk.dim(truncatePath(project.path, 35)));
          if (project.github) {
            console.log('  ' + chalk.cyan(linePrefix) + '   GitHub   ' + chalk.white(project.github));
          }
          console.log('  ' + chalk.cyan(linePrefix) + '   Branch   ' + chalk.dim(project.baseBranch || 'main'));
          console.log('  ' + chalk.cyan(linePrefix) + '   Context  ' + (project.context ? chalk.green('✓ Set') : chalk.dim('○ Empty')));
          if (!isLast) console.log('  ' + chalk.cyan('│'));
        }
      }

      // ─────────────────────────────────────────
      // AGENTS
      // ─────────────────────────────────────────
      console.log();
      ui.header('Agents');

      if (agents.length === 0) {
        console.log('  ' + chalk.dim('No agents configured'));
        console.log('  ' + chalk.dim(`Run ${chalk.cyan('boatclaw agents add')} to add one`));
      } else {
        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i];
          const isLast = i === agents.length - 1;
          const prefix = isLast ? '└─' : '├─';
          const linePrefix = isLast ? '  ' : '│ ';

          const statusIcon = agent.enabled ? chalk.green('●') : chalk.dim('○');
          const statusText = agent.enabled ? chalk.green('Active') : chalk.dim('Disabled');

          console.log('  ' + chalk.cyan(prefix) + ' ' + statusIcon + ' ' + chalk.bold(agent.name) + '  ' + statusText);

          const labels = agent.labels?.join(', ') || agent.label || 'none';
          console.log('  ' + chalk.cyan(linePrefix) + '   Labels   ' + chalk.white(labels));

          const projectList = agent.projects?.includes('*') ? 'All projects' : agent.projects?.join(', ') || 'none';
          console.log('  ' + chalk.cyan(linePrefix) + '   Scope    ' + chalk.dim(projectList));

          const provider = agent.provider || config.ai.provider;
          console.log('  ' + chalk.cyan(linePrefix) + '   Model    ' + chalk.dim(`${agent.model} (${provider})`));
          console.log('  ' + chalk.cyan(linePrefix) + '   Context  ' + (agent.context ? chalk.green('✓ Set') : chalk.dim('○ Empty')));

          if (!isLast) console.log('  ' + chalk.cyan('│'));
        }
      }

      // ─────────────────────────────────────────
      // FOOTER
      // ─────────────────────────────────────────
      console.log();
      ui.divider();
      console.log();
      console.log('  ' + chalk.dim('Config location: ' + BOATCLAW_DIR));
      console.log('  ' + chalk.dim('Start worker:    ' + chalk.cyan('boatclaw start')));
      console.log();
    });

  // Start command
  program
    .command('start')
    .description('Start the Boatclaw worker')
    .option('--dry-run', 'Run without making changes')
    .option('--interactive', 'Enable interactive mode - AI can ask questions via ticket comments (Claude Code only)')
    .action(async (options: { dryRun?: boolean; interactive?: boolean }) => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
        process.exit(1);
      }

      // Verify configuration
      const platformCheck = verifyPlatformConfig();
      if (!platformCheck.valid) {
        ui.error('Platform configuration incomplete:');
        for (const err of platformCheck.errors) {
          ui.listItem(err);
        }
        process.exit(1);
      }

      const workflowCheck = verifyWorkflowConfig();
      if (!workflowCheck.valid) {
        ui.error('Workflow configuration incomplete:');
        for (const err of workflowCheck.errors) {
          ui.listItem(err);
        }
        process.exit(1);
      }

      const config = configManager.load();
      const agents = Object.values(config.roles).filter((a) => a.enabled);

      if (agents.length === 0) {
        ui.error('No enabled agents configured.');
        ui.info(`Run ${chalk.cyan('boatclaw agents add')} to add one.`);
        process.exit(1);
      }

      // Validate project paths exist
      const allProjects = Object.values(config.projects);
      const missingPaths = allProjects.filter(p => !existsSync(p.path));
      if (missingPaths.length > 0) {
        ui.warning('Some project paths do not exist:');
        for (const p of missingPaths) {
          console.log(chalk.yellow(`  - ${p.name}: ${p.path}`));
        }
        if (missingPaths.length === allProjects.length) {
          ui.error('No valid project paths found. Fix paths with:');
          ui.info(`  ${chalk.cyan('boatclaw projects remove <name>')} then ${chalk.cyan('boatclaw projects add')}`);
          process.exit(1);
        }
        ui.dim('  Tasks for these projects will fail. Fix with: boatclaw projects remove <name> && boatclaw projects add');
        console.log();
      }

      ui.showLogo();

      // Check for existing worker
      if (existsSync(LOCK_FILE)) {
        try {
          const lockData = readFileSync(LOCK_FILE, 'utf-8').trim();
          const pid = parseInt(lockData, 10);
          // Check if process is still running
          try {
            process.kill(pid, 0); // signal 0 = just check if process exists
            ui.error(`Another boatclaw worker is already running (PID ${pid})`);
            ui.info('Run "boatclaw stop" to stop it first.');
            process.exit(1);
          } catch {
            // Process not running — stale lock file, clean it up
            unlinkSync(LOCK_FILE);
          }
        } catch {
          // Can't read lock file — remove it
          try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
        }
      }

      // Write lock file
      writeFileSync(LOCK_FILE, String(process.pid));

      // Resolve interactive mode from flag
      let interactiveEnabled = false;
      if (options.interactive) {
        if (config.ai.provider !== 'claude') {
          ui.warning('Interactive mode is only supported with Claude Code. Continuing without it.');
        } else {
          interactiveEnabled = true;
        }
      }

      if (options.dryRun) {
        ui.warning('Dry run mode - no changes will be made');
        console.log();
      }

      // Check AI availability
      const aiCheck = await checkAIAvailability(config.ai.provider);
      if (!aiCheck.available) {
        ui.error(`AI provider "${config.ai.provider}" is not available.`);
        if (aiCheck.error) {
          ui.dim(`  ${aiCheck.error}`);
        }
        ui.info(`Make sure the ${config.ai.provider} CLI is installed and in your PATH.`);
        try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
        process.exit(1);
      }

      ui.success(`AI provider: ${config.ai.provider} v${aiCheck.version || 'unknown'}`);
      console.log();

      // Create provider and worker
      const spinner = ui.spinner('Connecting to board...').start();

      try {
        const provider = createBoardProvider();
        const connected = await provider.verifyConnection();

        if (!connected) {
          spinner.fail('Failed to connect to board');
          try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
          process.exit(1);
        }

        spinner.succeed('Connected to board');

        // Show configuration
        console.log();
        ui.keyValue('Platform', config.platform || '');
        let boardDisplay = '';
        if (config.platform === 'trello') {
          boardDisplay = config.trello.boardName || config.trello.boardId || '';
        } else if (config.platform === 'jira') {
          boardDisplay = config.jira.projectName || config.jira.projectKey || '';
        } else if (config.platform === 'linear') {
          boardDisplay = config.linear.teamName || config.linear.teamId || '';
        }
        if (boardDisplay) {
          ui.keyValue('Board', boardDisplay);
        }
        ui.keyValue('Poll Interval', `${config.worker.pollInterval}s`);
        ui.keyValue('Agents', agents.map((a) => a.name).join(', '));
        console.log();

        // Check GitHub configuration and validate token
        // GitHub is enabled if we have a token and createPrs is on
        // defaultRepo is optional — projects can have their own github field
        let githubEnabled = !!(config.github.token && config.github.createPrs);

        if (githubEnabled) {
          // Validate token by making a test API call (auth only, no repo needed)
          try {
            const { GitHubClient } = await import('../../github/client.js');
            const testClient = new GitHubClient({
              token: config.github.token,
            });
            const valid = await testClient.verifyConnection();
            if (!valid) throw new Error('Invalid token');
            ui.success('GitHub PR creation enabled');
          } catch {
            ui.warning('GitHub token is invalid or expired. Continuing without GitHub PR creation.');
            ui.dim('  Run "boatclaw github setup" to reconfigure.');
            githubEnabled = false;
          }
        }

        if (interactiveEnabled) {
          console.log(chalk.bold.magenta('  \uD83D\uDD25 Interactive mode ON') + chalk.dim(' — AI can ask questions via ticket comments'));
        }

        // Show projects
        const projects = Object.values(config.projects);
        if (projects.length > 0) {
          ui.keyValue('Projects', projects.map((p) => p.name).join(', '));
        }
        console.log();

        // Create AI task processor with multi-project support
        const taskProcessor = createTaskProcessorFunction({
          dryRun: options.dryRun,
          createPRs: githubEnabled,
          githubToken: config.github.token,
          interactive: interactiveEnabled,
        });

        // Create worker with AI task processor
        const worker = createWorker(provider, {
          dryRun: options.dryRun,
          pollIntervalMs: (config.worker.pollInterval || 3) * 1000,
          maxParallelTasks: config.worker.maxParallelTasks || 10,
          taskProcessor,
          githubToken: githubEnabled ? config.github.token : undefined,
          githubEnabled,
        });

        // Set up event handlers
        setupWorkerEvents(worker, options.dryRun || false);

        // Handle shutdown
        let isShuttingDown = false;

        const shutdown = async () => {
          if (isShuttingDown) return;
          isShuttingDown = true;

          console.log();
          ui.info('Stopping worker...');

          await worker.stop();
          await provider.close();

          // Remove lock file
          try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }

          ui.success('Worker stopped');
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Start worker
        ui.info('Starting worker...');
        console.log();
        ui.divider();
        console.log(chalk.dim('Watching for cards in trigger list...'));
        console.log(chalk.dim('Press Ctrl+C to stop'));
        console.log();

        await worker.start();
      } catch (error) {
        spinner.fail('Failed to start worker');
        if (error instanceof Error) {
          ui.error(error.message);
        }
        // Clean up lock file on crash
        try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
        process.exit(1);
      }
    });

  // Stop command
  program
    .command('stop')
    .description('Stop the running Boatclaw worker')
    .action(async () => {
      if (!existsSync(LOCK_FILE)) {
        ui.info('No worker is running.');
        return;
      }

      try {
        const lockData = readFileSync(LOCK_FILE, 'utf-8').trim();
        const pid = parseInt(lockData, 10);

        // Check if process is actually running
        try {
          process.kill(pid, 0);
        } catch {
          ui.info('Worker is not running (stale lock file). Cleaning up.');
          unlinkSync(LOCK_FILE);
          return;
        }

        // Send stop signal
        ui.info(`Stopping worker (PID ${pid})...`);
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // On Windows, SIGTERM may not be supported — force kill
          process.kill(pid);
        }

        // Wait for it to stop (up to 10 seconds)
        let stopped = false;
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 500));
          try {
            process.kill(pid, 0);
          } catch {
            stopped = true;
            break;
          }
        }

        if (stopped) {
          // Clean up lock file if still there
          try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
          ui.success('Worker stopped.');
        } else {
          ui.warning('Worker did not stop gracefully. Force killing...');
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            process.kill(pid);
          }
          try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
          ui.success('Worker killed.');
        }
      } catch (error) {
        ui.error('Failed to stop worker: ' + (error instanceof Error ? error.message : String(error)));
      }
    });
}

function setupWorkerEvents(worker: Worker, dryRun: boolean): void {
  let pollCount = 0;

  worker.on('stateChange', (state) => {
    if (state === 'running') {
      // Already handled in start
    } else if (state === 'stopped') {
      // Already handled in shutdown
    }
  });

  worker.on('poll', (cardsFound: number) => {
    pollCount++;
    if (cardsFound > 0) {
      console.log(
        chalk.cyan(`[${timestamp()}]`) +
          ` Found ${cardsFound} card(s) in trigger list`
      );
    } else if (pollCount % 20 === 0) {
      // Log every 20 polls (~60 seconds) when idle
      console.log(
        chalk.dim(`[${timestamp()}]`) + chalk.dim(' Polling... (no tasks)')
      );
    }
  });

  worker.on('taskStart', (card: Card, role: RoleConfig) => {
    console.log();
    console.log(
      chalk.cyan(`[${timestamp()}]`) +
        chalk.bold(` Starting task: ${card.title}`)
    );
    console.log(chalk.dim(`  Agent: ${role.name} | Card ID: ${card.id}`));
    if (dryRun) {
      console.log(chalk.yellow('  (dry run - no changes will be made)'));
    }
  });

  worker.on('taskComplete', (result: TaskResult) => {
    if (result.success) {
      console.log(
        chalk.green(`[${timestamp()}]`) +
          chalk.green(` ✓ Task completed: ${result.cardTitle}`)
      );
      // Show all PRs if multi-project
      if (result.prUrls && result.prUrls.length > 0) {
        for (const prUrl of result.prUrls) {
          console.log(chalk.cyan(`  PR: ${prUrl}`));
        }
      } else if (result.prUrl) {
        console.log(chalk.cyan(`  PR: ${result.prUrl}`));
      }
      // Show project results if available
      if (result.projectResults && result.projectResults.length > 1) {
        for (const pr of result.projectResults) {
          const status = pr.success ? chalk.green('✓') : chalk.red('✗');
          console.log(chalk.dim(`  ${status} ${pr.projectName}`));
        }
      }
    } else {
      console.log(
        chalk.red(`[${timestamp()}]`) +
          chalk.red(` ✗ Task failed: ${result.cardTitle}`)
      );
      if (result.error) {
        console.log(chalk.dim(`  Error: ${result.error.slice(0, 100)}`));
      }
      // Show failed project details
      if (result.projectResults) {
        for (const pr of result.projectResults) {
          if (!pr.success && pr.error) {
            console.log(chalk.dim(`  ${pr.projectName}: ${pr.error.slice(0, 50)}`));
          }
        }
      }
    }
    console.log(
      chalk.dim(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`)
    );
    console.log();
  });

  worker.on('taskError', (card: Card, error: Error) => {
    console.log(
      chalk.red(`[${timestamp()}]`) + chalk.red(` Error processing: ${card.title}`)
    );
    console.log(chalk.dim(`  ${error.message}`));
  });

  worker.on('error', (error: Error) => {
    const msg = error.message;
    // Network timeouts and connection errors are transient — show as warning, not error
    if (msg.includes('timeout') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') || msg.includes('Failed to get cards')) {
      console.log(chalk.yellow(`[${timestamp()}]`) + chalk.dim(` Connection issue — retrying... (${msg.slice(0, 80)})`));
    } else {
      console.log(chalk.red(`[${timestamp()}]`) + chalk.red(` Error: ${msg}`));
    }
  });
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function truncatePath(filePath: string, maxLen: number): string {
  if (filePath.length <= maxLen) return filePath;
  // Show the last part of the path with ellipsis (works on all OS)
  const parts = filePath.split(sep);
  let result = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts.slice(i).join(sep);
    if (candidate.length + 3 <= maxLen) {
      result = '...' + sep + candidate;
    } else {
      break;
    }
  }
  return result || filePath.slice(-maxLen + 3) + '...';
}
