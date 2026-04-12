/**
 * MCP (Model Context Protocol) module.
 *
 * Provides MCP servers for AI tool integrations:
 * - ask_human: Allows AI to ask questions to humans via board comments
 */

export {
  createAskHumanServer,
  startAskHumanServer,
  type AskHumanServerOptions,
} from './ask-human-server.js';
