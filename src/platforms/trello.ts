/**
 * Trello board provider implementation.
 *
 * Uses Trello REST API to interact with boards, lists, and cards.
 * API docs: https://developer.atlassian.com/cloud/trello/rest/
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import https from 'https';
import {
  BoardProvider,
  Board,
  BoardList,
  Card,
  Label,
  Comment,
  CardOperationResult,
  FetchCardsOptions,
} from './types.js';
import { PlatformError } from '../core/errors.js';

const TRELLO_API_BASE = 'https://api.trello.com/1';

/**
 * Trello API response types
 */
interface TrelloBoard {
  id: string;
  name: string;
  url: string;
  desc: string;
}

interface TrelloList {
  id: string;
  name: string;
  pos: number;
  closed: boolean;
}

interface TrelloLabel {
  id: string;
  name: string;
  color: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  url: string;
  shortUrl: string;
  idList: string;
  pos: number;
  labels: TrelloLabel[];
  dateLastActivity: string;
  due: string | null;
  idMembers: string[];
}

interface TrelloAction {
  id: string;
  type: string;
  date: string;
  data: {
    text?: string;
  };
  memberCreator: {
    fullName: string;
    username: string;
  };
}

/**
 * Trello BoardProvider implementation.
 */
export class TrelloProvider implements BoardProvider {
  readonly name = 'trello';

  private client: AxiosInstance;
  private boardId: string;
  private apiKey: string;
  private apiToken: string;

  constructor(options: { apiKey: string; apiToken: string; boardId: string }) {
    this.apiKey = options.apiKey;
    this.apiToken = options.apiToken;
    this.boardId = options.boardId;

    this.client = axios.create({
      baseURL: TRELLO_API_BASE,
      timeout: 30000,
      params: {
        key: this.apiKey,
        token: this.apiToken,
      },
      httpsAgent: new https.Agent({ keepAlive: true }),
    });
  }

  /**
   * Verify the connection by fetching board info.
   */
  async verifyConnection(): Promise<boolean> {
    try {
      const response = await this.client.get<TrelloBoard>(
        `/boards/${this.boardId}`
      );
      return response.status === 200 && !!response.data.id;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401) {
          throw new PlatformError('Invalid Trello API key or token');
        }
        if (status === 404) {
          throw new PlatformError('Board not found');
        }
      }
      return false;
    }
  }

  /**
   * Get board information.
   */
  async getBoard(): Promise<Board> {
    try {
      const [boardResponse, listsResponse] = await Promise.all([
        this.client.get<TrelloBoard>(`/boards/${this.boardId}`),
        this.client.get<TrelloList[]>(`/boards/${this.boardId}/lists`, {
          params: { filter: 'open' },
        }),
      ]);

      const board = boardResponse.data;
      const lists = listsResponse.data;

      return {
        id: board.id,
        name: board.name,
        url: board.url,
        lists: lists.map((list) => ({
          id: list.id,
          name: list.name,
          position: list.pos,
        })),
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to get board');
    }
  }

  /**
   * Get all lists on the board.
   */
  async getLists(): Promise<BoardList[]> {
    try {
      const response = await this.client.get<TrelloList[]>(
        `/boards/${this.boardId}/lists`,
        { params: { filter: 'open' } }
      );

      return response.data.map((list) => ({
        id: list.id,
        name: list.name,
        position: list.pos,
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to get lists');
    }
  }

  /**
   * Get cards from a specific list.
   */
  async getCards(options: FetchCardsOptions): Promise<Card[]> {
    try {
      const response = await this.client.get<TrelloCard[]>(
        `/lists/${options.listId}/cards`,
        {
          params: {
            fields: 'id,name,desc,url,shortUrl,idList,pos,labels,dateLastActivity,due,idMembers',
          },
        }
      );

      // Get list name
      const listResponse = await this.client.get<TrelloList>(
        `/lists/${options.listId}`
      );
      const listName = listResponse.data.name;

      let cards = response.data.map((card) =>
        this.mapTrelloCard(card, listName)
      );

      // Filter by labels if specified
      if (options.labels && options.labels.length > 0) {
        cards = cards.filter((card) =>
          card.labels.some((label) =>
            options.labels!.some(
              (l) => l.toLowerCase() === label.name.toLowerCase()
            )
          )
        );
      }

      // Limit if specified
      if (options.limit && options.limit > 0) {
        cards = cards.slice(0, options.limit);
      }

      return cards;
    } catch (error) {
      throw this.handleError(error, 'Failed to get cards');
    }
  }

  /**
   * Get a single card by ID.
   */
  async getCard(cardId: string): Promise<Card | null> {
    try {
      const response = await this.client.get<TrelloCard>(`/cards/${cardId}`, {
        params: {
          fields: 'id,name,desc,url,shortUrl,idList,pos,labels,dateLastActivity,due,idMembers',
        },
      });

      // Get list name
      const listResponse = await this.client.get<TrelloList>(
        `/lists/${response.data.idList}`
      );

      return this.mapTrelloCard(response.data, listResponse.data.name);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw this.handleError(error, 'Failed to get card');
    }
  }

  /**
   * Move a card to a different list.
   */
  async moveCard(
    cardId: string,
    targetListId: string
  ): Promise<CardOperationResult> {
    try {
      const response = await this.client.put<TrelloCard>(`/cards/${cardId}`, null, {
        params: {
          idList: targetListId,
          pos: 'bottom',
        },
      });

      // Get list name
      const listResponse = await this.client.get<TrelloList>(
        `/lists/${targetListId}`
      );

      return {
        success: true,
        card: this.mapTrelloCard(response.data, listResponse.data.name),
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Add a comment to a card.
   */
  async addComment(
    cardId: string,
    text: string
  ): Promise<CardOperationResult> {
    try {
      await this.client.post(`/cards/${cardId}/actions/comments`, null, {
        params: { text },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Get comments on a card.
   */
  async getComments(cardId: string): Promise<Comment[]> {
    try {
      const response = await this.client.get<TrelloAction[]>(
        `/cards/${cardId}/actions`,
        {
          params: {
            filter: 'commentCard',
          },
        }
      );

      return response.data.map((action) => ({
        id: action.id,
        text: action.data.text || '',
        authorName: action.memberCreator.fullName,
        createdAt: new Date(action.date),
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to get comments');
    }
  }

  /**
   * Update card description.
   */
  async updateDescription(
    cardId: string,
    description: string
  ): Promise<CardOperationResult> {
    try {
      await this.client.put(`/cards/${cardId}`, null, {
        params: { desc: description },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Add a label to a card.
   */
  async addLabel(
    cardId: string,
    labelId: string
  ): Promise<CardOperationResult> {
    try {
      await this.client.post(`/cards/${cardId}/idLabels`, null, {
        params: { value: labelId },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Remove a label from a card.
   */
  async removeLabel(
    cardId: string,
    labelId: string
  ): Promise<CardOperationResult> {
    try {
      await this.client.delete(`/cards/${cardId}/idLabels/${labelId}`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Get all available labels on the board.
   */
  async getLabels(): Promise<Label[]> {
    try {
      const response = await this.client.get<TrelloLabel[]>(
        `/boards/${this.boardId}/labels`
      );

      return response.data
        .filter((label) => label.name) // Only labels with names
        .map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
        }));
    } catch (error) {
      throw this.handleError(error, 'Failed to get labels');
    }
  }

  /**
   * Close the provider (no cleanup needed for REST API).
   */
  async close(): Promise<void> {
    // No cleanup needed for REST API
  }

  // ==================== Helper Methods ====================

  private mapTrelloCard(trelloCard: TrelloCard, listName: string): Card {
    return {
      id: trelloCard.id,
      title: trelloCard.name,
      description: trelloCard.desc,
      url: trelloCard.shortUrl || trelloCard.url,
      labels: trelloCard.labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      listId: trelloCard.idList,
      listName,
      position: trelloCard.pos,
      createdAt: new Date(parseInt(trelloCard.id.substring(0, 8), 16) * 1000),
      updatedAt: new Date(trelloCard.dateLastActivity),
      dueDate: trelloCard.due ? new Date(trelloCard.due) : undefined,
      assignees: trelloCard.idMembers,
      metadata: {
        shortUrl: trelloCard.shortUrl,
        fullUrl: trelloCard.url,
      },
    };
  }

  private handleError(error: unknown, context: string): PlatformError {
    const message = this.getErrorMessage(error);
    return new PlatformError(`${context}: ${message}`);
  }

  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string }>;
      if (axiosError.response?.data?.message) {
        return axiosError.response.data.message;
      }
      if (axiosError.response?.status === 401) {
        return 'Authentication failed - check API key and token';
      }
      if (axiosError.response?.status === 404) {
        return 'Resource not found';
      }
      if (axiosError.response?.status === 429) {
        return 'Rate limit exceeded - try again later';
      }
      return axiosError.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

/**
 * Create a Trello provider instance.
 */
export function createTrelloProvider(options: {
  apiKey: string;
  apiToken: string;
  boardId: string;
}): TrelloProvider {
  return new TrelloProvider(options);
}
