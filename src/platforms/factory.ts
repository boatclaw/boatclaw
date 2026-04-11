/**
 * Platform factory for creating board providers.
 */

import { BoardProvider } from './types.js';
import { TrelloProvider } from './trello.js';
import { configManager, Platform } from '../core/config.js';
import { ConfigurationError } from '../core/errors.js';

/**
 * Create a board provider based on current configuration.
 */
export function createBoardProvider(): BoardProvider {
  const config = configManager.load();
  const platform = config.platform;

  if (!platform) {
    throw new ConfigurationError(
      'No platform configured. Run "boatclaw setup" first.'
    );
  }

  switch (platform) {
    case 'trello':
      return createTrelloProviderFromConfig();

    case 'jira':
      throw new ConfigurationError(
        'Jira integration coming soon. Currently only Trello is supported.'
      );

    case 'linear':
      throw new ConfigurationError(
        'Linear integration coming soon. Currently only Trello is supported.'
      );

    default:
      throw new ConfigurationError(`Unknown platform: ${platform}`);
  }
}

/**
 * Create a Trello provider from current configuration.
 */
function createTrelloProviderFromConfig(): TrelloProvider {
  const config = configManager.load();
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

export { TrelloProvider };
