/**
 * MCP Server entry point for ask_human tool.
 *
 * This script is spawned by Claude CLI when MCP is configured.
 * It reads board credentials from the config and starts the MCP server.
 *
 * Usage:
 *   node mcp-server.js --card-id CARD123 --provider trello
 *   node mcp-server.js --card-id terminal-123 --provider terminal --ask-dir /tmp/boatclaw-ask-xxx
 */

import { startAskHumanServer } from './mcp/index.js';
import { configManager } from './core/config.js';
import { createBoardProvider } from './platforms/factory.js';
import { createFileBoardProvider } from './mcp/file-board-provider.js';

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
  const providerType = argMap.get('provider') as 'trello' | 'jira' | 'linear' | 'terminal';
  const askDir = argMap.get('ask-dir');

  if (!cardId || !providerType) {
    console.error('Usage: mcp-server --card-id CARD_ID --provider trello|jira|linear|terminal');
    process.exit(1);
  }

  try {
    let boardProvider;

    if (providerType === 'terminal' && askDir) {
      // Terminal mode: use file-based board provider
      boardProvider = createFileBoardProvider(askDir);
    } else {
      // Board mode: load config and create real provider
      const config = configManager.load();
      boardProvider = createBoardProvider(providerType as 'trello' | 'jira' | 'linear', config);
    }

    // Start MCP server
    await startAskHumanServer({
      cardId,
      boardProvider,
      pollIntervalMs: providerType === 'terminal' ? 1000 : 5000, // Poll faster in terminal
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
