/**
 * Custom error types for Boatclaw.
 */

/**
 * Base error for Boatclaw.
 */
export class BoatclawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoatclawError';
  }
}

/**
 * Configuration errors.
 */
export class ConfigurationError extends BoatclawError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Platform/board errors.
 */
export class PlatformError extends BoatclawError {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformError';
  }
}

/**
 * AI provider errors.
 */
export class AIError extends BoatclawError {
  constructor(message: string) {
    super(message);
    this.name = 'AIError';
  }
}

/**
 * GitHub integration errors.
 */
export class GitHubError extends BoatclawError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}
