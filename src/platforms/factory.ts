/**
 * Platform factory for creating board providers.
 */

import { BoardProvider } from './types.js';
import { TrelloProvider } from './trello.js';
import { JiraProvider } from './jira.js';
import { LinearProvider } from './linear.js';
import { configManager, Platform } from '../core/config.js';
import { ConfigurationError } from '../core/errors.js';

/**
 * Create a board provider based on current configuration.
 *
 * @param platform - Optional platform override (defaults to config value)
 * @param configOverride - Optional config override (defaults to global config)
 */
export function createBoardProvider(
  platform?: Platform,
  configOverride?: ReturnType<typeof configManager.load>
): BoardProvider {
  const config = configOverride || configManager.load();
  const targetPlatform = platform || config.platform;

  if (!targetPlatform) {
    throw new ConfigurationError(
      'No platform configured. Run "boatclaw setup" first.'
    );
  }

  switch (targetPlatform) {
    case 'trello':
      return createTrelloProviderFromConfig(config);

    case 'jira':
      return createJiraProviderFromConfig(config);

    case 'linear':
      return createLinearProviderFromConfig(config);

    default:
      throw new ConfigurationError(`Unknown platform: ${targetPlatform}`);
  }
}

/**
 * Create a Trello provider from current configuration.
 */
function createTrelloProviderFromConfig(
  config: ReturnType<typeof configManager.load>
): TrelloProvider {
  const trelloConfig = config.trello;

  if (!trelloConfig.apiKey) {
    throw new ConfigurationError('Trello API key not configured');
  }

  if (!trelloConfig.apiToken) {
    throw new ConfigurationError('Trello API token not configured');
  }

  if (!trelloConfig.boardId) {
    throw new ConfigurationError('Trello board ID not configured');
  }

  return new TrelloProvider({
    apiKey: trelloConfig.apiKey,
    apiToken: trelloConfig.apiToken,
    boardId: trelloConfig.boardId,
  });
}

/**
 * Verify platform configuration is complete.
 */
export function verifyPlatformConfig(): { valid: boolean; errors: string[] } {
  const config = configManager.load();
  const errors: string[] = [];

  if (!config.platform) {
    errors.push('No platform selected');
    return { valid: false, errors };
  }

  switch (config.platform) {
    case 'trello':
      if (!config.trello.apiKey) errors.push('Trello API key missing');
      if (!config.trello.apiToken) errors.push('Trello API token missing');
      if (!config.trello.boardId) errors.push('Trello board ID missing');
      break;

    case 'jira':
      if (!config.jira.instanceUrl) errors.push('Jira instance URL missing');
      if (!config.jira.email) errors.push('Jira email missing');
      if (!config.jira.apiToken) errors.push('Jira API token missing');
      if (!config.jira.projectKey) errors.push('Jira project key missing');
      break;

    case 'linear':
      if (!config.linear.apiKey) errors.push('Linear API key missing');
      if (!config.linear.teamId) errors.push('Linear team ID missing');
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Verify workflow configuration is complete.
 */
export function verifyWorkflowConfig(): { valid: boolean; errors: string[] } {
  const config = configManager.load();
  const errors: string[] = [];

  if (!config.workflow.triggerId) {
    errors.push('Trigger list not configured');
  }

  if (!config.workflow.workingId) {
    errors.push('Working list not configured');
  }

  if (!config.workflow.successId) {
    errors.push('Success list not configured');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a Jira provider from current configuration.
 */
function createJiraProviderFromConfig(
  config: ReturnType<typeof configManager.load>
): JiraProvider {
  const jiraConfig = config.jira;

  if (!jiraConfig.instanceUrl) {
    throw new ConfigurationError('Jira instance URL not configured');
  }

  if (!jiraConfig.email) {
    throw new ConfigurationError('Jira email not configured');
  }

  if (!jiraConfig.apiToken) {
    throw new ConfigurationError('Jira API token not configured');
  }

  if (!jiraConfig.projectKey) {
    throw new ConfigurationError('Jira project key not configured');
  }

  return new JiraProvider({
    instanceUrl: jiraConfig.instanceUrl,
    email: jiraConfig.email,
    apiToken: jiraConfig.apiToken,
    projectKey: jiraConfig.projectKey,
  });
}

/**
 * Create a Linear provider from current configuration.
 */
function createLinearProviderFromConfig(
  config: ReturnType<typeof configManager.load>
): LinearProvider {
  const linearConfig = config.linear;

  if (!linearConfig.apiKey) {
    throw new ConfigurationError('Linear API key not configured');
  }

  if (!linearConfig.teamId) {
    throw new ConfigurationError('Linear team ID not configured');
  }

  return new LinearProvider({
    apiKey: linearConfig.apiKey,
    teamId: linearConfig.teamId,
  });
}

export { TrelloProvider, JiraProvider, LinearProvider };
