/**
 * MCP Server entry point for ask_human tool.
 *
 * This script is spawned by Claude CLI when MCP is configured.
 * It reads board credentials from the config and starts the MCP server.
 *
 * Usage:
 *   node mcp-server.js --card-id CARD123 --provider trello
 */

import { startAskHumanServer } from './mcp/index.js';
import { configManager } from './core/config.js';
import { createBoardProvider } from './platforms/factory.js';

async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const argMap = new Map<string, string>();

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    argMap.set(key, value);
  }

  const cardId = argMap.get('card-id');
  const providerType = argMap.get('provider') as 'trello' | 'jira' | 'linear';

  if (!cardId || !providerType) {
    console.error('Usage: mcp-server --card-id CARD_ID --provider trello|jira|linear');
    process.exit(1);
  }

  try {
    // Load config
    const config = configManager.load();

    // Create board provider
    const boardProvider = createBoardProvider(providerType, config);

    // Start MCP server
    await startAskHumanServer({
      cardId,
      boardProvider,
      pollIntervalMs: 5000,   // Poll every 5 seconds
      timeoutMs: 1800000,     // 30 minute timeout
    });
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('MCP server error:', error);
  process.exit(1);
});
