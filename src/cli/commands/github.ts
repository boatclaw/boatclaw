/**
 * GitHub setup and management commands.
 *
 * Commands:
 * - github setup: Configure GitHub integration
 * - github status: Show GitHub connection status
 * - github test: Test GitHub connection
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { configManager } from '../../core/config.js';
import { isInitialized } from '../../core/paths.js';
import { GitHubClient } from '../../github/client.js';
import * as ui from '../ui.js';

export function registerGitHubCommands(program: Command): void {
  const github = program
    .command('github')
    .description('GitHub integration management');

  // Default action: show status
  github.action(() => {
    showGitHubStatus();
  });

  // Setup command
  github
    .command('setup')
    .description('Setup GitHub integration')
    .action(async () => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
        return;
      }

      ui.header('GitHub Integration Setup');

      console.log(
        chalk.dim(
          'Get a Personal Access Token from: https://github.com/settings/tokens'
        )
      );
      console.log(chalk.dim('Required scopes: repo, read:user'));
      console.log();

      const { token } = await inquirer.prompt([
        {
          type: 'password',
          name: 'token',
          message: 'GitHub Personal Access Token:',
          validate: (input: string) =>
            input.length > 0 || 'Token is required',
        },
      ]);

      const spinner = ui.spinner('Verifying token...').start();

      const client = new GitHubClient({ token });

      try {
        const valid = await client.verifyConnection();
        if (!valid) {
          spinner.fail('Invalid token');
          return;
        }

        const user = await client.getUser();
        spinner.succeed(`Authenticated as ${chalk.bold(user.login)}`);

        // Get repository
        const { repo } = await inquirer.prompt([
          {
            type: 'input',
            name: 'repo',
            message: 'Default repository (owner/repo):',
            validate: (input: string) => {
              if (!input.includes('/')) {
                return 'Format: owner/repo';
              }
              return true;
            },
          },
        ]);

        // Verify repo access and get default branch
        spinner.start('Verifying repository access...');
        try {
          const defaultBranch = await client.getDefaultBranch(repo);
          spinner.succeed(`Repository accessible (branch: ${defaultBranch})`);

          // Get branch settings
          const { baseBranch, branchPrefix, createPrs, autoReview } =
            await inquirer.prompt([
              {
                type: 'input',
                name: 'baseBranch',
                message: 'Base branch for PRs:',
                default: defaultBranch,
              },
              {
                type: 'input',
                name: 'branchPrefix',
                message: 'Branch name prefix:',
                default: 'feature/',
              },
              {
                type: 'confirm',
                name: 'createPrs',
                message: 'Automatically create PRs for completed tasks?',
                default: true,
              },
              {
                type: 'confirm',
                name: 'autoReview',
                message: 'Enable automatic code review?',
                default: true,
              },
            ]);

          // Save configuration
          const config = configManager.load();
          config.github = {
            enabled: true,
            token,
            defaultRepo: repo,
            baseBranch,
            branchPrefix,
            createPrs,
            autoReview,
          };
          configManager.save(config);

          console.log();
          ui.success('GitHub integration configured!');
          console.log();
          ui.keyValue('Repository', repo);
          ui.keyValue('Base Branch', baseBranch);
          ui.keyValue('Create PRs', createPrs ? 'Yes' : 'No');
          ui.keyValue('Auto Review', autoReview ? 'Yes' : 'No');
          console.log();
        } catch (error) {
          spinner.fail('Failed to access repository');
          ui.error(
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      } catch (error) {
        spinner.fail('Setup failed');
        ui.error(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        await client.close();
      }
    });

  // Status command
  github
    .command('status')
    .description('Show GitHub connection status')
    .action(async () => {
      await showGitHubStatus();
    });

  // Test command
  github
    .command('test')
    .description('Test GitHub connection')
    .action(async () => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        return;
      }

      const config = configManager.load();

      if (!config.github.enabled || !config.github.token) {
        ui.error('GitHub not configured.');
        ui.info(`Run ${chalk.cyan('boatclaw github setup')} to configure.`);
        return;
      }

      ui.header('GitHub Connection Test');

      const client = new GitHubClient({
        token: config.github.token,
        defaultRepo: config.github.defaultRepo,
      });

      try {
        // Test auth
        let spinner = ui.spinner('Testing authentication...').start();
        const user = await client.getUser();
        spinner.succeed(`Authenticated as ${chalk.bold(user.login)}`);

        // Test repo access (if defaultRepo is set)
        if (config.github.defaultRepo) {
          spinner = ui.spinner('Testing repository access...').start();
          const defaultBranch = await client.getDefaultBranch();
          spinner.succeed(`Repository accessible (branch: ${defaultBranch})`);

          // Test branch check
          spinner = ui.spinner('Testing branch operations...').start();
          const baseBranchExists = await client.branchExists(
            config.github.baseBranch
          );
          if (baseBranchExists) {
            spinner.succeed(`Base branch "${config.github.baseBranch}" exists`);
          } else {
            spinner.warn(
              `Base branch "${config.github.baseBranch}" not found`
            );
          }
        } else {
          // No default repo — check project-level repos instead
          const projects = Object.values(configManager.getProjects()).filter(p => p.github);
          if (projects.length > 0) {
            for (const project of projects) {
              spinner = ui.spinner(`Testing ${project.github}...`).start();
              try {
                const projectClient = new GitHubClient({ token: config.github.token, defaultRepo: project.github });
                await projectClient.getDefaultBranch();
                spinner.succeed(`${project.github} accessible`);
                await projectClient.close();
              } catch {
                spinner.fail(`${project.github} not accessible`);
              }
            }
          } else {
            ui.warning('No repository configured. Set one with "boatclaw github setup" or add github to projects.');
          }
        }

        console.log();
        ui.success('All tests passed!');
        console.log();
      } catch (error) {
        ui.error(
          `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } finally {
        await client.close();
      }
    });

  // Disable command
  github
    .command('disable')
    .description('Disable GitHub integration')
    .action(async () => {
      if (!isInitialized()) {
        ui.error('Boatclaw is not configured.');
        return;
      }

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to disable GitHub integration?',
          default: false,
        },
      ]);

      if (!confirm) {
        ui.info('Cancelled.');
        return;
      }

      const config = configManager.load();
      config.github.enabled = false;
      configManager.save(config);

      ui.success('GitHub integration disabled.');
    });
}

async function showGitHubStatus(): Promise<void> {
  if (!isInitialized()) {
    ui.error('Boatclaw is not configured.');
    ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
    return;
  }

  const config = configManager.load();

  ui.header('GitHub Integration Status');

  if (!config.github.enabled || !config.github.token) {
    ui.keyValue('Status', chalk.dim('Not configured'));
    ui.info(`Run ${chalk.cyan('boatclaw github setup')} to configure.`);
    console.log();
    return;
  }

  const spinner = ui.spinner('Checking connection...').start();

  const client = new GitHubClient({
    token: config.github.token,
    defaultRepo: config.github.defaultRepo,
  });

  try {
    const valid = await client.verifyConnection();

    if (valid) {
      const user = await client.getUser();
      spinner.succeed('Connected');

      console.log();
      ui.keyValue('User', user.login);
      ui.keyValue('Repository', config.github.defaultRepo);
      ui.keyValue('Base Branch', config.github.baseBranch);
      ui.keyValue('Branch Prefix', config.github.branchPrefix);
      ui.keyValue('Create PRs', config.github.createPrs ? 'Yes' : 'No');
      ui.keyValue('Auto Review', config.github.autoReview ? 'Yes' : 'No');
    } else {
      spinner.fail('Connection failed - token may be invalid');
    }
  } catch (error) {
    spinner.fail(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    await client.close();
  }

  console.log();

  ui.actions([
    { cmd: 'boatclaw github setup', desc: 'Configure GitHub integration' },
    { cmd: 'boatclaw github test', desc: 'Test connection' },
    { cmd: 'boatclaw github disable', desc: 'Disable GitHub integration' },
  ]);
}
