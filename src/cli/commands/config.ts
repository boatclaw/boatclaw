/**
 * Configuration management commands.
 *
 * Commands:
 * - config show: Show current configuration
 * - config get <key>: Get a specific config value
 * - config set <key> <value>: Set a config value
 * - config reset: Reset configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { configManager } from '../../core/config.js';
import { CONFIG_FILE, isInitialized } from '../../core/paths.js';
import { readFileSync } from 'fs';
import * as ui from '../ui.js';

export function registerConfigCommands(program: Command): void {
  const config = program
    .command('config')
    .description('Configuration management');

  // Show full config
  config
    .command('show')
    .description('Show current configuration')
    .option('--raw', 'Show raw YAML')
    .action(async (options: { raw?: boolean }) => {
      if (!isInitialized()) {
        ui.error('No configuration found.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} to create one.`);
        return;
      }

      if (options.raw) {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        console.log(content);
        return;
      }

      const cfg = configManager.load();
      console.log();
      console.log(chalk.bold('Boatclaw Configuration'));
      console.log(chalk.dim(CONFIG_FILE));
      console.log();
      console.log(JSON.stringify(cfg, null, 2));
    });

  // Get specific value
  config
    .command('get <key>')
    .description('Get a configuration value (dot notation: platform, ai.provider)')
    .action(async (key: string) => {
      if (!isInitialized()) {
        ui.error('No configuration found.');
        return;
      }

      const value = configManager.get(key);

      if (value === undefined) {
        ui.error(`Key "${key}" not found`);
        return;
      }

      if (typeof value === 'object') {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
    });

  // Set specific value
  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key: string, value: string) => {
      if (!isInitialized()) {
        ui.error('No configuration found.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} first.`);
        return;
      }

      // Try to parse as JSON for complex values
      let parsedValue: unknown = value;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Keep as string if not valid JSON
        // Handle booleans
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        // Handle numbers
        else if (!isNaN(Number(value))) parsedValue = Number(value);
      }

      configManager.set(key, parsedValue);
      ui.success(`Set ${key} = ${JSON.stringify(parsedValue)}`);
    });

  // Reset config
  config
    .command('reset')
    .description('Reset all configuration')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: { yes?: boolean }) => {
      if (!options.yes) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to reset all configuration?',
            default: false,
          },
        ]);

        if (!confirm) {
          ui.info('Reset cancelled.');
          return;
        }
      }

      configManager.reset();
      ui.success('Configuration reset.');
      ui.info(`Run ${chalk.cyan('boatclaw setup')} to reconfigure.`);
    });

  // Path command (show config path)
  config
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      console.log(CONFIG_FILE);
    });
}
