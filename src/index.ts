/**
 * Boatclaw CLI - AI-powered task automation for development teams.
 *
 * Open source and free to use.
 * Connect your project boards to AI coding assistants.
 */

import { Command } from 'commander';
import { registerSetupCommand } from './cli/commands/setup.js';
import { registerStatusCommands } from './cli/commands/status.js';
import { registerConfigCommands } from './cli/commands/config.js';
import { registerAgentsCommands } from './cli/commands/agents.js';
import { registerProjectsCommands } from './cli/commands/projects.js';
import { registerContextCommands } from './cli/commands/context.js';
import { registerGitHubCommands } from './cli/commands/github.js';
import { registerLogsCommands } from './cli/commands/logs.js';

const VERSION = '0.1.0';

// Create the main program
const program = new Command();

program
  .name('boatclaw')
  .description('AI-powered task automation for development teams - Open Source')
  .version(VERSION, '-v, --version', 'Display version number');

// Register all commands
registerSetupCommand(program);
registerStatusCommands(program);
registerConfigCommands(program);
registerProjectsCommands(program);
registerAgentsCommands(program);
registerContextCommands(program);
registerGitHubCommands(program);
registerLogsCommands(program);

// Default action (no command provided)
program.action(() => {
  program.help();
});

// Parse arguments
program.parse(process.argv);

// Export for programmatic usage
export { configManager } from './core/config.js';
export type { BoatclawConfig, RoleConfig, Platform, AIProvider } from './core/config.js';
