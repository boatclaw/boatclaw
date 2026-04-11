/**
 * Platform types and interfaces for board providers.
 *
 * All board integrations (Trello, Jira, Linear) implement BoardProvider.
 */

/**
 * A label on a card/issue.
 */
export interface Label {
  id: string;
  name: string;
  color?: string;
}

/**
 * A card/issue from a board.
 */
export interface Card {
  id: string;
  title: string;
  description: string;
  url: string;
  labels: Label[];
  listId: string;
  listName: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  assignees: string[];
  metadata: Record<string, unknown>;
}

/**
 * A list/column/status on a board.
 */
export interface BoardList {
  id: string;
  name: string;
  position: number;
  cardCount?: number;
}

/**
 * Board information.
 */
export interface Board {
  id: string;
  name: string;
  url: string;
  lists: BoardList[];
}

/**
 * Comment on a card.
 */
export interface Comment {
  id: string;
  text: string;
  authorName: string;
  createdAt: Date;
}

/**
 * Result of a card operation.
 */
export interface CardOperationResult {
  success: boolean;
  card?: Card;
  error?: string;
}

/**
 * Options for fetching cards.
 */
export interface FetchCardsOptions {
  listId: string;
  labels?: string[];
  limit?: number;
}

/**
 * Abstract board provider interface.
 *
 * All platform integrations must implement this interface.
 */
export interface BoardProvider {
  /**
   * Provider name (trello, jira, linear).
   */
  readonly name: string;

  /**
   * Verify the connection and credentials.
   */
  verifyConnection(): Promise<boolean>;

  /**
   * Get board information.
   */
  getBoard(): Promise<Board>;

  /**
   * Get all lists on the board.
   */
  getLists(): Promise<BoardList[]>;

  /**
   * Get cards from a specific list.
   */
  getCards(options: FetchCardsOptions): Promise<Card[]>;

  /**
   * Get a single card by ID.
   */
  getCard(cardId: string): Promise<Card | null>;

  /**
   * Move a card to a different list.
   */
  moveCard(cardId: string, targetListId: string): Promise<CardOperationResult>;

  /**
   * Add a comment to a card.
   */
  addComment(cardId: string, text: string): Promise<CardOperationResult>;

  /**
   * Get comments on a card.
   */
  getComments(cardId: string): Promise<Comment[]>;

  /**
   * Update card description.
   */
  updateDescription(cardId: string, description: string): Promise<CardOperationResult>;

  /**
   * Add a label to a card.
   */
  addLabel(cardId: string, labelId: string): Promise<CardOperationResult>;

  /**
   * Remove a label from a card.
   */
  removeLabel(cardId: string, labelId: string): Promise<CardOperationResult>;

  /**
   * Get all available labels on the board.
   */
  getLabels(): Promise<Label[]>;

  /**
   * Close the provider (cleanup resources).
   */
  close(): Promise<void>;
}

/**
 * Event emitted when a card is found in the trigger list.
 */
export interface CardEvent {
  type: 'new_card' | 'card_updated' | 'card_moved';
  card: Card;
  timestamp: Date;
}

/**
 * Callback for card events.
 */
export type CardEventCallback = (event: CardEvent) => void | Promise<void>;
