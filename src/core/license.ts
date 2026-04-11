/**
 * Boatclaw is open source and free.
 *
 * This module provides unlimited access to all features.
 * No license management, no usage tracking, no limits.
 */

// ==================== Types ====================

export enum Plan {
  OPEN_SOURCE = 'open_source',
}

export interface PlanLimits {
  projects: number;
  roles: number;
  tasksPerMonth: number;
  parallelTasks: number;
  githubPR: boolean;
  autoReview: boolean;
  prioritySupport: boolean;
}

export interface LicenseData {
  plan: Plan;
  status: 'active';
}

// Unlimited everything for open source
const UNLIMITED_LIMITS: PlanLimits = {
  projects: Infinity,
  roles: Infinity,
  tasksPerMonth: Infinity,
  parallelTasks: 10,
  githubPR: true,
  autoReview: true,
  prioritySupport: false,
};

// ==================== License Manager ====================

/**
 * Simplified license manager for open source version.
 * All features are enabled, no limits.
 */
export class LicenseManager {
  /**
   * Get plan limits - always returns unlimited.
   */
  getLimits(): PlanLimits {
    return UNLIMITED_LIMITS;
  }

  /**
   * Check if a feature is available - always true.
   */
  checkFeature(_feature: string): boolean {
    return true;
  }

  /**
   * Check if within limits - always allowed.
   */
  checkLimit(_limitType: string, _currentValue: number = 0): { allowed: boolean; message: string } {
    return { allowed: true, message: '' };
  }

  /**
   * Get license info - returns open source status.
   */
  getLicenseInfo(): LicenseData {
    return {
      plan: Plan.OPEN_SOURCE,
      status: 'active',
    };
  }

  /**
   * Get current plan.
   */
  getPlan(): Plan {
    return Plan.OPEN_SOURCE;
  }

  /**
   * No-op for tracking (kept for compatibility).
   */
  trackTask(): void {}
  trackPR(): void {}
  trackReview(): void {}

  /**
   * Get usage stats - not tracked in open source.
   */
  getUsageStats(): {
    tasksUsed: number;
    tasksLimit: number;
    prsCreated: number;
    reviewsDone: number;
  } {
    return {
      tasksUsed: 0,
      tasksLimit: Infinity,
      prsCreated: 0,
      reviewsDone: 0,
    };
  }
}

// Singleton instance
export const licenseManager = new LicenseManager();

// ==================== Helper Functions ====================

export function requirePlan(_minPlan: Plan): void {
  // No-op - all features available
}

export function canUseFeature(_feature: string): boolean {
  return true;
}

export function canUseLimit(_limitType: string, _currentValue: number): boolean {
  return true;
}
