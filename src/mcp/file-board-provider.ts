/**
 * File-based board provider for terminal interactive mode.
 *
 * Instead of posting comments to a real board (Trello/Jira/Linear),
 * this provider uses files in a shared directory to communicate
 * between the MCP server process and the main boatclaw process.
 *
 * Flow:
 * 1. MCP server calls addComment(cardId, text)
 * 2. This writes {id}.comment to askDir
 * 3. Main process watches askDir, prints question to terminal
 * 4. User types answer, main process writes {id}.answer
 * 5. MCP server calls getComments() which reads all .comment and .answer files
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { BoardProvider, Card, Board, BoardList, Label, Comment, CardOperationResult, FetchCardsOptions } from '../platforms/types.js';

/**
 * Create a file-based board provider for terminal interactive mode.
 */
export function createFileBoardProvider(askDir: string): BoardProvider {
  let commentCounter = 0;

  // Ensure directory exists
  if (!existsSync(askDir)) {
    mkdirSync(askDir, { recursive: true });
  }

  return {
    name: 'terminal',

    verifyConnection: async () => true,
    getBoard: async (): Promise<Board> => ({ id: '', name: 'Terminal', url: '', lists: [] }),
    getLists: async (): Promise<BoardList[]> => [],
    getCards: async (_options: FetchCardsOptions): Promise<Card[]> => [],
    getCard: async (): Promise<Card | null> => null,
    moveCard: async (): Promise<CardOperationResult> => ({ success: true }),
    updateDescription: async (): Promise<CardOperationResult> => ({ success: true }),
    addLabel: async (): Promise<CardOperationResult> => ({ success: true }),
    removeLabel: async (): Promise<CardOperationResult> => ({ success: true }),
    getLabels: async (): Promise<Label[]> => [],
    close: async () => {},

    /**
     * Write a comment as a file. The main process watches for these.
     */
    addComment: async (_cardId: string, text: string): Promise<CardOperationResult> => {
      const id = `${Date.now()}-${++commentCounter}`;
      const filePath = join(askDir, `${id}.comment`);
      writeFileSync(filePath, JSON.stringify({
        id,
        text,
        authorName: 'AI',
        createdAt: new Date().toISOString(),
      }));
      return { success: true };
    },

    /**
     * Read all comments and answers from files.
     * The MCP server polls this to find answers to questions.
     */
    getComments: async (): Promise<Comment[]> => {
      if (!existsSync(askDir)) return [];

      const files = readdirSync(askDir).filter(f => f.endsWith('.comment') || f.endsWith('.answer'));
      const comments: Comment[] = [];

      for (const file of files.sort()) {
        try {
          const data = JSON.parse(readFileSync(join(askDir, file), 'utf-8'));
          comments.push({
            id: data.id,
            text: data.text,
            authorName: data.authorName || 'Unknown',
            createdAt: new Date(data.createdAt),
          });
        } catch {
          // Skip invalid files
        }
      }

      return comments;
    },
  };
}
