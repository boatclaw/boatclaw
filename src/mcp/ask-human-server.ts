/**
 * MCP Server for ask_human tool.
 *
 * This server exposes an `ask_human` tool that allows Claude Code to
 * ask questions to humans via board comments (Trello/Jira/Linear).
 *
 * Flow:
 * 1. Claude calls ask_human("What format should the API use?")
 * 2. Server posts comment to the ticket: "🤖 Question: What format should the API use?"
 * 3. Server polls for a reply comment
 * 4. Returns the human's answer to Claude
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BoardProvider } from '../platforms/types.js';

/**
 * Question posted to the board.
 */
interface PendingQuestion {
  questionId: string;
  cardId: string;
  question: string;
  postedAt: Date;
  commentId?: string;
}

/**
 * Options for creating the ask-human server.
 */
export interface AskHumanServerOptions {
  cardId: string;
  boardProvider: BoardProvider;
  pollIntervalMs?: number;
  timeoutMs?: number;
  questionPrefix?: string;
  answerPrefix?: string;
}

/**
 * Create and start the MCP ask-human server.
 */
export async function createAskHumanServer(
  options: AskHumanServerOptions
): Promise<Server> {
  const {
    cardId,
    boardProvider,
    pollIntervalMs = 5000,      // Poll every 5 seconds
    timeoutMs = 1800000,        // 30 minute timeout
    questionPrefix = '🤖 Question from AI:',
    answerPrefix = '💬 Answer:',
  } = options;

  const server = new Server(
    {
      name: 'boatclaw-ask-human',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Track pending questions
  const pendingQuestions: Map<string, PendingQuestion> = new Map();
  let questionCounter = 0;

  /**
   * List available tools.
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'ask_human',
          description: `Ask a question to the human and wait for their response.
The question will be posted as a comment on the task ticket.
The human will reply with a comment starting with "${answerPrefix}".
Use this when you need clarification, approval, or human input.
This tool blocks until the human responds or times out.`,
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask the human. Be clear and specific.',
              },
            },
            required: ['question'],
          },
        },
        {
          name: 'post_update',
          description: `Post a progress update or status comment to the task ticket.
Use this to keep the human informed about what you're doing.
Good for: starting work, completing milestones, reporting issues, or final summary.`,
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'The update message to post. Be concise but informative.',
              },
              type: {
                type: 'string',
                enum: ['progress', 'milestone', 'issue', 'complete'],
                description: 'Type of update: progress (working on), milestone (achieved), issue (problem found), complete (finished)',
              },
            },
            required: ['message'],
          },
        },
      ],
    };
  });

  /**
   * Handle tool calls.
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;

    // Handle post_update tool
    if (toolName === 'post_update') {
      const { message, type } = request.params.arguments as { message: string; type?: string };

      if (!message || typeof message !== 'string') {
        return {
          content: [{ type: 'text', text: 'Error: message parameter is required' }],
          isError: true,
        };
      }

      // Format the update with emoji based on type
      const typeEmoji: Record<string, string> = {
        progress: '🔄',
        milestone: '✅',
        issue: '⚠️',
        complete: '🎉',
      };
      const emoji = typeEmoji[type || 'progress'] || '📝';
      const commentText = `${emoji} **AI Update:**\n\n${message}`;

      try {
        const postResult = await boardProvider.addComment(cardId, commentText);

        if (!postResult.success) {
          return {
            content: [{ type: 'text', text: `Failed to post update: ${postResult.error}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: 'Update posted successfully' }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error posting update: ${errorMessage}` }],
          isError: true,
        };
      }
    }

    // Handle ask_human tool
    if (toolName !== 'ask_human') {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${toolName}`,
          },
        ],
        isError: true,
      };
    }

    const { question } = request.params.arguments as { question: string };

    if (!question || typeof question !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: question parameter is required',
          },
        ],
        isError: true,
      };
    }

    try {
      // Generate unique question ID
      const questionId = `q-${Date.now()}-${++questionCounter}`;

      // Get comments BEFORE posting to establish baseline
      const baselineComments = await boardProvider.getComments(cardId);
      const baselineIds = new Set(baselineComments.map(c => c.id));

      // Post question as comment
      const commentText = `${questionPrefix}\n\n${question}\n\n---\n_Reply with a comment starting with "Answer:" to answer (or "${answerPrefix}")_`;

      const postResult = await boardProvider.addComment(cardId, commentText);

      if (!postResult.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to post question: ${postResult.error}`,
            },
          ],
          isError: true,
        };
      }

      // After posting, get comments again to find our question's ID
      // and add it to the baseline so we don't match it as an answer
      const postQuestionComments = await boardProvider.getComments(cardId);
      for (const c of postQuestionComments) {
        if (!baselineIds.has(c.id)) {
          // This is likely our question comment - add to baseline
          baselineIds.add(c.id);
        }
      }

      // Track pending question
      const pending: PendingQuestion = {
        questionId,
        cardId,
        question,
        postedAt: new Date(),
      };
      pendingQuestions.set(questionId, pending);

      // Poll for answer
      const answer = await pollForAnswer(
        boardProvider,
        cardId,
        baselineIds,
        answerPrefix,
        pollIntervalMs,
        timeoutMs
      );

      // Clean up
      pendingQuestions.delete(questionId);

      if (answer === null) {
        return {
          content: [
            {
              type: 'text',
              text: `Timeout: No answer received after ${timeoutMs / 1000 / 60} minutes. The human did not respond.`,
            },
          ],
          isError: false, // Not an error, just no response
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: answer,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error asking human: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Poll for an answer comment.
 */
async function pollForAnswer(
  provider: BoardProvider,
  cardId: string,
  baselineCommentIds: Set<string>,
  answerPrefix: string,
  pollIntervalMs: number,
  timeoutMs: number
): Promise<string | null> {
  const startTime = Date.now();

  // Normalize the prefix - strip emojis for more robust matching
  const normalizedPrefix = answerPrefix.toLowerCase().trim();
  // Also create a version without the emoji for fallback matching
  const prefixWithoutEmoji = normalizedPrefix.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

  while (Date.now() - startTime < timeoutMs) {
    // Wait before polling
    await sleep(pollIntervalMs);

    try {
      const comments = await provider.getComments(cardId);

      // Look for new comments with answer prefix
      for (const comment of comments) {
        // Skip comments we've already seen
        if (baselineCommentIds.has(comment.id)) {
          continue;
        }

        // Strip markdown formatting (bold, italics, etc.)
        const text = comment.text.trim()
          .replace(/^\*+|\*+$/g, '')  // Remove leading/trailing asterisks (italics/bold)
          .replace(/^_+|_+$/g, '')    // Remove leading/trailing underscores
          .replace(/^#+\s*/g, '')     // Remove heading markers
          .trim();
        const lowerText = text.toLowerCase();
        // Also create a version without emoji for matching
        const lowerTextWithoutEmoji = lowerText.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

        // Check if this is an answer - multiple detection methods
        // 1. Exact prefix match
        if (lowerText.startsWith(normalizedPrefix)) {
          const answer = text.slice(answerPrefix.length).trim();
          return answer || '(Empty answer)';
        }

        // 2. Prefix without emoji match
        if (lowerTextWithoutEmoji.startsWith(prefixWithoutEmoji)) {
          // Find where the actual content starts (after "answer:")
          const colonIndex = text.indexOf(':');
          if (colonIndex !== -1) {
            return text.slice(colonIndex + 1).trim() || '(Empty answer)';
          }
        }

        // 3. Common answer patterns
        if (
          lowerText.startsWith('answer:') ||
          lowerTextWithoutEmoji.startsWith('answer:') ||
          lowerText.startsWith('reply:') ||
          lowerText.startsWith('response:') ||
          lowerText.startsWith('a:')  // Short form
        ) {
          const colonIndex = text.indexOf(':');
          return text.slice(colonIndex + 1).trim() || '(Empty answer)';
        }

        // 4. Any new comment from a human (not containing our question prefix)
        // This is a fallback - if someone just replies without the prefix
        const questionMarker = '🤖 question from ai:';
        const updateMarker = 'ai update:';
        if (!lowerText.includes(questionMarker) && !lowerText.includes(updateMarker)) {
          // Check if this looks like a human response (not an AI-generated comment)
          // If it's been more than 10 seconds since we started, accept any new comment
          if (Date.now() - startTime > 10000) {
            return text;
          }
        }
      }
    } catch {
      // Continue polling on transient errors
    }
  }

  return null; // Timeout
}

/**
 * Sleep utility.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start the MCP server with stdio transport.
 * This is called when running the server as a standalone process.
 */
export async function startAskHumanServer(
  options: AskHumanServerOptions
): Promise<void> {
  const server = await createAskHumanServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
