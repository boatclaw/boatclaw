/**
 * Path constants for Boatclaw configuration.
 *
 * All config is stored in ~/.boatclaw/
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export const BOATCLAW_DIR = join(homedir(), '.boatclaw');
export const CONFIG_FILE = join(BOATCLAW_DIR, 'config.yaml');
export const LOG_DIR = join(BOATCLAW_DIR, 'logs');
export const CONTEXT_DIR = join(BOATCLAW_DIR, 'context');
export const CACHE_DIR = join(BOATCLAW_DIR, 'cache');
export const WORKTREE_DIR = join(BOATCLAW_DIR, 'worktrees');
export const LOCK_FILE = join(BOATCLAW_DIR, 'worker.lock');

/**
 * Ensure all necessary directories exist.
 */
export function ensureDirs(): void {
  const dirs = [BOATCLAW_DIR, LOG_DIR, CONTEXT_DIR, CACHE_DIR, WORKTREE_DIR];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Get the config directory path.
 */
export function getConfigDir(): string {
  return BOATCLAW_DIR;
}

/**
 * Check if Boatclaw has been initialized.
 */
export function isInitialized(): boolean {
  return existsSync(CONFIG_FILE);
}
