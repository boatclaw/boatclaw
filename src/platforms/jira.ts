/**
 * Jira board provider implementation.
 *
 * Uses Jira REST API v3 to interact with projects, statuses, and issues.
 * API docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
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

/**
 * Jira API response types
 */
interface JiraProject {
  id: string;
  key: string;
  name: string;
  self: string;
}

interface JiraStatus {
  id: string;
  name: string;
  statusCategory: {
    id: number;
    key: string;
    name: string;
  };
}

interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: {
      content?: Array<{
        content?: Array<{
          text?: string;
        }>;
      }>;
    } | string | null;
    status: JiraStatus;
    labels: string[];
    priority?: {
      id: string;
      name: string;
    };
    assignee?: JiraUser | null;
    reporter?: JiraUser;
    created: string;
    updated: string;
    duedate?: string | null;
    issuetype: JiraIssueType;
  };
}

interface JiraComment {
  id: string;
  body: {
    content?: Array<{
      content?: Array<{
        text?: string;
      }>;
    }>;
  } | string;
  author: JiraUser;
  created: string;
}

interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
}

/**
 * Jira BoardProvider implementation.
 */
export class JiraProvider implements BoardProvider {
  readonly name = 'jira';

  private client: AxiosInstance;
  private instanceUrl: string;
  private projectKey: string;
  private statusToListMap: Map<string, BoardList> = new Map();

  constructor(options: {
    instanceUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
  }) {
    this.instanceUrl = options.instanceUrl.replace(/\/$/, '');
    this.projectKey = options.projectKey;

    // Create base64 auth token
    const auth = Buffer.from(`${options.email}:${options.apiToken}`).toString('base64');

    this.client = axios.create({
      baseURL: `${this.instanceUrl}/rest/api/3`,
      timeout: 30000,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Verify the connection by fetching project info.
   */
  async verifyConnection(): Promise<boolean> {
    try {
      const response = await this.client.get<JiraProject>(
        `/project/${this.projectKey}`
      );
      return response.status === 200 && !!response.data.id;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401) {
          throw new PlatformError('Invalid Jira credentials (email or API token)');
        }
        if (status === 404) {
          throw new PlatformError(`Project "${this.projectKey}" not found`);
        }
      }
      return false;
    }
  }

  /**
   * Get board (project) information.
   * In Jira, we treat statuses as "lists".
   */
  async getBoard(): Promise<Board> {
    try {
      const [projectResponse, statusesResponse] = await Promise.all([
        this.client.get<JiraProject>(`/project/${this.projectKey}`),
        this.client.get(`/project/${this.projectKey}/statuses`),
      ]);

      const project = projectResponse.data;
      const statuses = statusesResponse.data as Array<{
        id: string;
        name: string;
        statuses: JiraStatus[];
      }>;

      // Flatten statuses from all issue types and deduplicate
      const statusMap = new Map<string, BoardList>();
      let position = 0;

      for (const issueType of statuses) {
        for (const status of issueType.statuses) {
          if (!statusMap.has(status.id)) {
            const list: BoardList = {
              id: status.id,
              name: status.name,
              position: position++,
            };
            statusMap.set(status.id, list);
            this.statusToListMap.set(status.id, list);
            this.statusToListMap.set(status.name.toLowerCase(), list);
          }
        }
      }

      return {
        id: project.id,
        name: project.name,
        url: `${this.instanceUrl}/browse/${project.key}`,
        lists: Array.from(statusMap.values()),
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to get project');
    }
  }

  /**
   * Get all statuses (lists) for the project.
   */
  async getLists(): Promise<BoardList[]> {
    try {
      const response = await this.client.get(`/project/${this.projectKey}/statuses`);
      const statuses = response.data as Array<{
        id: string;
        name: string;
        statuses: JiraStatus[];
      }>;

      const statusMap = new Map<string, BoardList>();
      let position = 0;

      for (const issueType of statuses) {
        for (const status of issueType.statuses) {
          if (!statusMap.has(status.id)) {
            const list: BoardList = {
              id: status.id,
              name: status.name,
              position: position++,
            };
            statusMap.set(status.id, list);
            this.statusToListMap.set(status.id, list);
            this.statusToListMap.set(status.name.toLowerCase(), list);
          }
        }
      }

      return Array.from(statusMap.values());
    } catch (error) {
      throw this.handleError(error, 'Failed to get statuses');
    }
  }

  /**
   * Get issues from a specific status (list).
   */
  async getCards(options: FetchCardsOptions): Promise<Card[]> {
    try {
      // Build JQL query
      let jql = `project = "${this.projectKey}" AND status = "${options.listId}"`;

      // Add label filter if specified
      if (options.labels && options.labels.length > 0) {
        const labelFilter = options.labels.map(l => `"${l}"`).join(', ');
        jql += ` AND labels IN (${labelFilter})`;
      }

      jql += ' ORDER BY created DESC';

      const response = await this.client.get<{
        issues: JiraIssue[];
        total: number;
      }>('/search/jql', {
        params: {
          jql,
          maxResults: options.limit || 50,
          fields: 'summary,description,status,labels,priority,assignee,reporter,created,updated,duedate,issuetype',
        },
      });

      return response.data.issues.map((issue) => this.mapJiraIssue(issue));
    } catch (error) {
      throw this.handleError(error, 'Failed to get issues');
    }
  }

  /**
   * Get a single issue by ID or key.
   */
  async getCard(cardId: string): Promise<Card | null> {
    try {
      const response = await this.client.get<JiraIssue>(`/issue/${cardId}`, {
        params: {
          fields: 'summary,description,status,labels,priority,assignee,reporter,created,updated,duedate,issuetype',
        },
      });

      return this.mapJiraIssue(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw this.handleError(error, 'Failed to get issue');
    }
  }

  /**
   * Move an issue to a different status using transitions.
   * Note: Jira workflow rules may restrict which transitions are available.
   */
  async moveCard(cardId: string, targetListId: string): Promise<CardOperationResult> {
    try {
      // Get available transitions for this issue
      const transitionsResponse = await this.client.get<{
        transitions: JiraTransition[];
      }>(`/issue/${cardId}/transitions`);

      const availableTransitions = transitionsResponse.data.transitions;

      // Find transition to target status (by ID or name)
      const transition = availableTransitions.find(
        (t) => t.to.id === targetListId || t.to.name.toLowerCase() === targetListId.toLowerCase()
      );

      if (!transition) {
        // Provide helpful error with available transitions
        const availableNames = availableTransitions.map(t => t.to.name).join(', ');
        return {
          success: false,
          error: `Cannot transition to "${targetListId}". Available transitions: ${availableNames || 'none'}. Check your Jira workflow rules.`,
        };
      }

      // Perform transition
      await this.client.post(`/issue/${cardId}/transitions`, {
        transition: { id: transition.id },
      });

      // Fetch updated issue
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
      await this.client.post(`/issue/${cardId}/comment`, {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: text,
                },
              ],
            },
          ],
        },
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
      const response = await this.client.get<{
        comments: JiraComment[];
      }>(`/issue/${cardId}/comment`);

      return response.data.comments.map((comment) => ({
        id: comment.id,
        text: this.extractTextFromAdf(comment.body),
        authorName: comment.author.displayName,
        createdAt: new Date(comment.created),
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
      await this.client.put(`/issue/${cardId}`, {
        fields: {
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: description,
                  },
                ],
              },
            ],
          },
        },
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
      await this.client.put(`/issue/${cardId}`, {
        update: {
          labels: [{ add: labelId }],
        },
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
      await this.client.put(`/issue/${cardId}`, {
        update: {
          labels: [{ remove: labelId }],
        },
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
   * Get all labels used in the project.
   */
  async getLabels(): Promise<Label[]> {
    try {
      // Jira doesn't have a direct endpoint for project labels
      // We search for issues to find used labels
      const response = await this.client.get<{
        issues: JiraIssue[];
      }>('/search/jql', {
        params: {
          jql: `project = "${this.projectKey}" AND labels IS NOT EMPTY`,
          maxResults: 100,
          fields: 'labels',
        },
      });

      // Collect unique labels
      const labelSet = new Set<string>();
      for (const issue of response.data.issues) {
        for (const label of issue.fields.labels) {
          labelSet.add(label);
        }
      }

      return Array.from(labelSet).map((name) => ({
        id: name,
        name: name,
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

  private mapJiraIssue(issue: JiraIssue): Card {
    return {
      id: issue.key,
      title: issue.fields.summary,
      description: this.extractTextFromAdf(issue.fields.description),
      url: `${this.instanceUrl}/browse/${issue.key}`,
      labels: issue.fields.labels.map((name) => ({
        id: name,
        name: name,
      })),
      listId: issue.fields.status.id,
      listName: issue.fields.status.name,
      position: 0,
      createdAt: new Date(issue.fields.created),
      updatedAt: new Date(issue.fields.updated),
      dueDate: issue.fields.duedate ? new Date(issue.fields.duedate) : undefined,
      assignees: issue.fields.assignee ? [issue.fields.assignee.displayName] : [],
      metadata: {
        key: issue.key,
        issueType: issue.fields.issuetype.name,
        priority: issue.fields.priority?.name,
        reporter: issue.fields.reporter?.displayName,
      },
    };
  }

  /**
   * Extract plain text from Jira's Atlassian Document Format.
   */
  private extractTextFromAdf(adf: JiraIssue['fields']['description']): string {
    if (!adf) return '';
    if (typeof adf === 'string') return adf;

    const texts: string[] = [];

    const extractFromContent = (content: unknown[]): void => {
      for (const node of content) {
        if (typeof node === 'object' && node !== null) {
          const n = node as Record<string, unknown>;
          if (n.text && typeof n.text === 'string') {
            texts.push(n.text);
          }
          if (Array.isArray(n.content)) {
            extractFromContent(n.content);
          }
        }
      }
    };

    if (adf.content) {
      extractFromContent(adf.content);
    }

    return texts.join('\n');
  }

  private handleError(error: unknown, context: string): PlatformError {
    const message = this.getErrorMessage(error);
    return new PlatformError(`${context}: ${message}`);
  }

  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{
        errorMessages?: string[];
        errors?: Record<string, string>;
      }>;

      if (axiosError.response?.data?.errorMessages?.length) {
        return axiosError.response.data.errorMessages.join(', ');
      }
      if (axiosError.response?.data?.errors) {
        return Object.values(axiosError.response.data.errors).join(', ');
      }
      if (axiosError.response?.status === 401) {
        return 'Authentication failed - check email and API token';
      }
      if (axiosError.response?.status === 403) {
        return 'Access denied - check permissions';
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
 * Create a Jira provider instance.
 */
export function createJiraProvider(options: {
  instanceUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}): JiraProvider {
  return new JiraProvider(options);
}
