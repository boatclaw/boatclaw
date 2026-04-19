/**
 * Linear board provider implementation.
 *
 * Uses Linear GraphQL API to interact with teams, issues, and states.
 * API docs: https://developers.linear.app/docs/graphql/working-with-the-graphql-api
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

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Linear GraphQL response types
 */
interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

interface LinearState {
  id: string;
  name: string;
  position: number;
  type: string;
}

interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

interface LinearUser {
  id: string;
  name: string;
  email: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  state: LinearState;
  labels: {
    nodes: LinearLabel[];
  };
  assignee?: LinearUser | null;
  creator?: LinearUser;
  createdAt: string;
  updatedAt: string;
  dueDate?: string | null;
  priority: number;
  priorityLabel: string;
}

interface LinearComment {
  id: string;
  body: string;
  user: LinearUser;
  createdAt: string;
}

/**
 * Linear BoardProvider implementation.
 */
export class LinearProvider implements BoardProvider {
  readonly name = 'linear';

  private client: AxiosInstance;
  private teamId: string;
  private stateMap: Map<string, BoardList> = new Map();

  constructor(options: { apiKey: string; teamId: string }) {
    this.teamId = options.teamId;

    this.client = axios.create({
      baseURL: LINEAR_API_URL,
      timeout: 30000,
      headers: {
        'Authorization': options.apiKey,
        'Content-Type': 'application/json',
      },
      httpsAgent: new https.Agent({ keepAlive: true }),
    });
  }

  /**
   * Execute a GraphQL query.
   */
  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.client.post('', { query, variables });

    if (response.data.errors?.length) {
      throw new PlatformError(response.data.errors[0].message);
    }

    return response.data.data;
  }

  /**
   * Verify the connection by fetching team info.
   */
  async verifyConnection(): Promise<boolean> {
    try {
      const data = await this.query<{ team: LinearTeam }>(`
        query($id: String!) {
          team(id: $id) {
            id
            key
            name
          }
        }
      `, { id: this.teamId });

      return !!data.team?.id;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401) {
          throw new PlatformError('Invalid Linear API key');
        }
      }
      return false;
    }
  }

  /**
   * Get board (team) information with workflow states as lists.
   */
  async getBoard(): Promise<Board> {
    try {
      const data = await this.query<{
        team: LinearTeam & {
          states: { nodes: LinearState[] };
        };
      }>(`
        query($id: String!) {
          team(id: $id) {
            id
            key
            name
            states {
              nodes {
                id
                name
                position
                type
              }
            }
          }
        }
      `, { id: this.teamId });

      const team = data.team;
      const states = team.states.nodes.sort((a, b) => a.position - b.position);

      // Cache states for later lookup
      this.stateMap.clear();
      for (const state of states) {
        const list: BoardList = {
          id: state.id,
          name: state.name,
          position: state.position,
        };
        this.stateMap.set(state.id, list);
        this.stateMap.set(state.name.toLowerCase(), list);
      }

      return {
        id: team.id,
        name: team.name,
        url: `https://linear.app/team/${team.key}`,
        lists: states.map((state, index) => ({
          id: state.id,
          name: state.name,
          position: index,
        })),
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to get team');
    }
  }

  /**
   * Get all workflow states (lists) for the team.
   */
  async getLists(): Promise<BoardList[]> {
    try {
      const data = await this.query<{
        team: {
          states: { nodes: LinearState[] };
        };
      }>(`
        query($id: String!) {
          team(id: $id) {
            states {
              nodes {
                id
                name
                position
                type
              }
            }
          }
        }
      `, { id: this.teamId });

      const states = data.team.states.nodes.sort((a, b) => a.position - b.position);

      // Cache states
      this.stateMap.clear();
      for (const state of states) {
        const list: BoardList = {
          id: state.id,
          name: state.name,
          position: state.position,
        };
        this.stateMap.set(state.id, list);
        this.stateMap.set(state.name.toLowerCase(), list);
      }

      return states.map((state, index) => ({
        id: state.id,
        name: state.name,
        position: index,
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to get states');
    }
  }

  /**
   * Get issues from a specific state (list).
   */
  async getCards(options: FetchCardsOptions): Promise<Card[]> {
    try {
      // Build filter
      const filter: Record<string, unknown> = {
        team: { id: { eq: this.teamId } },
        state: { id: { eq: options.listId } },
      };

      // Add label filter if specified
      if (options.labels && options.labels.length > 0) {
        filter.labels = {
          some: {
            name: { in: options.labels },
          },
        };
      }

      const data = await this.query<{
        issues: { nodes: LinearIssue[] };
      }>(`
        query($filter: IssueFilter, $first: Int) {
          issues(filter: $filter, first: $first, orderBy: createdAt) {
            nodes {
              id
              identifier
              title
              description
              url
              state {
                id
                name
                position
              }
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
              assignee {
                id
                name
                email
              }
              creator {
                id
                name
                email
              }
              createdAt
              updatedAt
              dueDate
              priority
              priorityLabel
            }
          }
        }
      `, {
        filter,
        first: options.limit || 50,
      });

      return data.issues.nodes.map((issue) => this.mapLinearIssue(issue));
    } catch (error) {
      throw this.handleError(error, 'Failed to get issues');
    }
  }

  /**
   * Get a single issue by ID.
   */
  async getCard(cardId: string): Promise<Card | null> {
    try {
      const data = await this.query<{ issue: LinearIssue | null }>(`
        query($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            description
            url
            state {
              id
              name
              position
            }
            labels {
              nodes {
                id
                name
                color
              }
            }
            assignee {
              id
              name
              email
            }
            creator {
              id
              name
              email
            }
            createdAt
            updatedAt
            dueDate
            priority
            priorityLabel
          }
        }
      `, { id: cardId });

      if (!data.issue) {
        return null;
      }

      return this.mapLinearIssue(data.issue);
    } catch (error) {
      throw this.handleError(error, 'Failed to get issue');
    }
  }

  /**
   * Move an issue to a different state.
   */
  async moveCard(cardId: string, targetListId: string): Promise<CardOperationResult> {
    try {
      await this.query(`
        mutation($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
            issue {
              id
            }
          }
        }
      `, {
        id: cardId,
        stateId: targetListId,
      });

      const card = await this.getCard(cardId);

      return {
        success: true,
        card: card || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Add a comment to an issue.
   */
  async addComment(cardId: string, text: string): Promise<CardOperationResult> {
    try {
      await this.query(`
        mutation($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
          }
        }
      `, {
        issueId: cardId,
        body: text,
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
   * Get comments on an issue.
   */
  async getComments(cardId: string): Promise<Comment[]> {
    try {
      const data = await this.query<{
        issue: {
          comments: { nodes: LinearComment[] };
        };
      }>(`
        query($id: String!) {
          issue(id: $id) {
            comments {
              nodes {
                id
                body
                user {
                  id
                  name
                  email
                }
                createdAt
              }
            }
          }
        }
      `, { id: cardId });

      return data.issue.comments.nodes.map((comment) => ({
        id: comment.id,
        text: comment.body,
        authorName: comment.user.name,
        createdAt: new Date(comment.createdAt),
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to get comments');
    }
  }

  /**
   * Update issue description.
   */
  async updateDescription(cardId: string, description: string): Promise<CardOperationResult> {
    try {
      await this.query(`
        mutation($id: String!, $description: String!) {
          issueUpdate(id: $id, input: { description: $description }) {
            success
          }
        }
      `, {
        id: cardId,
        description,
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
   * Add a label to an issue.
   */
  async addLabel(cardId: string, labelId: string): Promise<CardOperationResult> {
    try {
      // Get current labels
      const card = await this.getCard(cardId);
      if (!card) {
        return { success: false, error: 'Issue not found' };
      }

      const currentLabelIds = card.labels.map((l) => l.id);
      const newLabelIds = [...currentLabelIds, labelId];

      await this.query(`
        mutation($id: String!, $labelIds: [String!]!) {
          issueUpdate(id: $id, input: { labelIds: $labelIds }) {
            success
          }
        }
      `, {
        id: cardId,
        labelIds: newLabelIds,
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
   * Remove a label from an issue.
   */
  async removeLabel(cardId: string, labelId: string): Promise<CardOperationResult> {
    try {
      // Get current labels
      const card = await this.getCard(cardId);
      if (!card) {
        return { success: false, error: 'Issue not found' };
      }

      const newLabelIds = card.labels.filter((l) => l.id !== labelId).map((l) => l.id);

      await this.query(`
        mutation($id: String!, $labelIds: [String!]!) {
          issueUpdate(id: $id, input: { labelIds: $labelIds }) {
            success
          }
        }
      `, {
        id: cardId,
        labelIds: newLabelIds,
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
   * Get all labels for the team.
   */
  async getLabels(): Promise<Label[]> {
    try {
      const data = await this.query<{
        team: {
          labels: { nodes: LinearLabel[] };
        };
      }>(`
        query($id: String!) {
          team(id: $id) {
            labels {
              nodes {
                id
                name
                color
              }
            }
          }
        }
      `, { id: this.teamId });

      return data.team.labels.nodes.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to get labels');
    }
  }

  /**
   * Close the provider (no cleanup needed).
   */
  async close(): Promise<void> {
    // No cleanup needed
  }

  // ==================== Helper Methods ====================

  private mapLinearIssue(issue: LinearIssue): Card {
    return {
      id: issue.id,
      title: issue.title,
      description: issue.description || '',
      url: issue.url,
      labels: issue.labels.nodes.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      listId: issue.state.id,
      listName: issue.state.name,
      position: 0,
      createdAt: new Date(issue.createdAt),
      updatedAt: new Date(issue.updatedAt),
      dueDate: issue.dueDate ? new Date(issue.dueDate) : undefined,
      assignees: issue.assignee ? [issue.assignee.name] : [],
      metadata: {
        identifier: issue.identifier,
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        creator: issue.creator?.name,
      },
    };
  }

  private handleError(error: unknown, context: string): PlatformError {
    const message = this.getErrorMessage(error);
    return new PlatformError(`${context}: ${message}`);
  }

  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{
        errors?: Array<{ message: string }>;
      }>;

      if (axiosError.response?.data?.errors?.length) {
        return axiosError.response.data.errors[0].message;
      }
      if (axiosError.response?.status === 401) {
        return 'Authentication failed - check API key';
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
 * Create a Linear provider instance.
 */
export function createLinearProvider(options: {
  apiKey: string;
  teamId: string;
}): LinearProvider {
  return new LinearProvider(options);
}
