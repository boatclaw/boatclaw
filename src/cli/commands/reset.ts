/**
 * Reset command - clear all Boatclaw configuration.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { rmSync, existsSync } from 'fs';
import { BOATCLAW_DIR } from '../../core/paths.js';
import * as ui from '../ui.js';

export function registerResetCommand(program: Command): void {
  program
    .command('reset')
    .description('Reset all Boatclaw configuration')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: { yes?: boolean }) => {
      if (!existsSync(BOATCLAW_DIR)) {
        ui.info('Nothing to reset. Boatclaw is not configured.');
        return;
      }

      console.log();
      console.log(chalk.yellow('  ⚠ This will delete all Boatclaw configuration:'));
      console.log();
      console.log(chalk.dim(`     ${BOATCLAW_DIR}`));
      console.log();
      console.log(chalk.dim('     - config.yaml (all settings)'));
      console.log(chalk.dim('     - All projects'));
      console.log(chalk.dim('     - All agents'));
      console.log(chalk.dim('     - All context'));
      console.log(chalk.dim('     - All logs'));
      console.log();

      if (!options.yes) {
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          message: chalk.red('Are you sure you want to reset everything?'),
          default: false,
        }]);

        if (!confirmed) {
          ui.info('Reset cancelled.');
          return;
        }
      }

      try {
        rmSync(BOATCLAW_DIR, { recursive: true, force: true });
        console.log();
        ui.success('All configuration has been reset.');
        ui.info(`Run ${chalk.cyan('boatclaw setup')} to start fresh.`);
      } catch (err) {
        ui.error(`Failed to reset: ${(err as Error).message}`);
      }
    });
}
