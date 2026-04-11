/**
 * Configuration management for Boatclaw.
 *
 * Config is stored in ~/.boatclaw/config.yaml
 * Uses Zod for validation.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import { z } from 'zod';
import { CONFIG_FILE, ensureDirs } from './paths.js';

// ==================== Schemas ====================

export const PlatformSchema = z.enum(['trello', 'jira', 'linear']);
export type Platform = z.infer<typeof PlatformSchema>;

export const AIProviderSchema = z.enum(['claude', 'cursor']);
export type AIProvider = z.infer<typeof AIProviderSchema>;

export const ModelSchema = z.enum(['auto', 'haiku', 'sonnet', 'opus']);
export type Model = z.infer<typeof ModelSchema>;

export const TrelloConfigSchema = z.object({
  apiKey: z.string().default(''),
  apiToken: z.string().default(''),
  boardId: z.string().default(''),
  boardName: z.string().default(''),
});
export type TrelloConfig = z.infer<typeof TrelloConfigSchema>;

export const JiraConfigSchema = z.object({
  instanceUrl: z.string().default(''),
  email: z.string().default(''),
  apiToken: z.string().default(''),
  projectKey: z.string().default(''),
  projectName: z.string().default(''),
});
export type JiraConfig = z.infer<typeof JiraConfigSchema>;

export const LinearConfigSchema = z.object({
  apiKey: z.string().default(''),
  teamId: z.string().default(''),
  teamName: z.string().default(''),
});
export type LinearConfig = z.infer<typeof LinearConfigSchema>;

export const WorkflowConfigSchema = z.object({
  triggerId: z.string().default(''),
  triggerName: z.string().default(''),
  workingId: z.string().default(''),
  workingName: z.string().default(''),
  reviewId: z.string().default(''),
  reviewName: z.string().default(''),
  successId: z.string().default(''),
  successName: z.string().default(''),
  failedId: z.string().default(''),
  failedName: z.string().default(''),
});
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

/**
 * Project configuration.
 * A project represents a repository/codebase that can be worked on.
 */
export const ProjectConfigSchema = z.object({
  name: z.string(),
  path: z.string(),                              // Local path to the repo
  github: z.string().optional(),                 // GitHub repo "owner/repo" for PRs
  context: z.string().optional(),                // Project context stored directly in config
  baseBranch: z.string().default('main'),        // Base branch for PRs
  branchPrefix: z.string().default('feature/'),  // Branch prefix for PRs
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

/**
 * Role/Agent configuration.
 * An agent represents an AI worker that can work on tasks.
 * Agents can handle multiple labels and work on multiple projects.
 */
export const RoleConfigSchema = z.object({
  name: z.string(),
  labels: z.array(z.string()),                   // Labels this agent handles (e.g., ["backend", "api"])
  projects: z.array(z.string()).default(['*']),  // Projects this agent can work on ("*" = all)
  context: z.string().optional(),                // Agent context stored directly in config
  provider: AIProviderSchema.optional(),         // AI provider (claude/cursor) - uses global default if not set
  model: ModelSchema.default('auto'),
  enabled: z.boolean().default(true),
  // Legacy support - will be migrated
  label: z.string().optional(),
  repoPath: z.string().optional(),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

export const GitHubConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
  defaultRepo: z.string().default(''),
  createPrs: z.boolean().default(true),
  autoReview: z.boolean().default(true),
  branchPrefix: z.string().default('feature/'),
  baseBranch: z.string().default('main'),
});
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

export const AIConfigSchema = z.object({
  provider: AIProviderSchema.default('claude'),
  defaultModel: ModelSchema.default('auto'),
  apiKey: z.string().optional(),
  timeoutSeconds: z.number().default(1800),
});
export type AIConfig = z.infer<typeof AIConfigSchema>;

export const WorkerConfigSchema = z.object({
  mode: z.enum(['polling', 'webhook']).default('polling'),
  pollInterval: z.number().default(3),
  maxParallelTasks: z.number().default(10),
  dryRun: z.boolean().default(false),
});
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  file: z.string().optional(),
});
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

export const BoatclawConfigSchema = z.object({
  version: z.string().default('1'),
  platform: PlatformSchema.optional(),
  trello: TrelloConfigSchema.default({}),
  jira: JiraConfigSchema.default({}),
  linear: LinearConfigSchema.default({}),
  workflow: WorkflowConfigSchema.default({}),
  projects: z.record(z.string(), ProjectConfigSchema).default({}),
  roles: z.record(z.string(), RoleConfigSchema).default({}),
  github: GitHubConfigSchema.default({}),
  ai: AIConfigSchema.default({}),
  worker: WorkerConfigSchema.default({}),
  projectContextFile: z.string().optional(),
  logging: LoggingConfigSchema.default({}),
});
export type BoatclawConfig = z.infer<typeof BoatclawConfigSchema>;

// ==================== Config Manager ====================

export class ConfigManager {
  private config: BoatclawConfig | null = null;

  /**
   * Load configuration from file.
   */
  load(): BoatclawConfig {
    if (this.config) {
      return this.config;
    }

    if (!existsSync(CONFIG_FILE)) {
      this.config = BoatclawConfigSchema.parse({});
      return this.config;
    }

    try {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      const data = yaml.load(content) || {};
      this.config = BoatclawConfigSchema.parse(data);
      return this.config;
    } catch {
      // If parsing fails, return defaults
      this.config = BoatclawConfigSchema.parse({});
      return this.config;
    }
  }

  /**
   * Save configuration to file.
   */
  save(config?: BoatclawConfig): void {
    if (config) {
      this.config = config;
    }

    if (!this.config) {
      throw new Error('No configuration to save');
    }

    ensureDirs();
    const content = yaml.dump(this.config, { indent: 2 });
    writeFileSync(CONFIG_FILE, content, 'utf-8');
  }

  /**
   * Get a config value by dot-notation path.
   */
  get<T = unknown>(path: string, defaultValue?: T): T {
    const config = this.load();
    const keys = path.split('.');
    let value: unknown = config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return defaultValue as T;
      }
    }

    return value as T;
  }

  /**
   * Set a config value by dot-notation path.
   */
  set(path: string, value: unknown): void {
    const config = this.load();
    const keys = path.split('.');
    let obj: Record<string, unknown> = config as Record<string, unknown>;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in obj) || typeof obj[key] !== 'object') {
        obj[key] = {};
      }
      obj = obj[key] as Record<string, unknown>;
    }

    obj[keys[keys.length - 1]] = value;
    this.save(config);
  }

  /**
   * Check if configuration is complete for running.
   */
  isConfigured(): boolean {
    const config = this.load();
    return (
      config.platform !== undefined &&
      Object.keys(config.roles).length > 0 &&
      config.workflow.triggerId !== ''
    );
  }

  /**
   * Check if basic setup is done (platform selected).
   */
  hasBasicSetup(): boolean {
    const config = this.load();
    return config.platform !== undefined;
  }

  /**
   * Reset configuration (clear all).
   */
  reset(): void {
    this.config = BoatclawConfigSchema.parse({});
    this.save();
  }

  /**
   * Get platform-specific config.
   */
  getPlatformConfig(): TrelloConfig | JiraConfig | LinearConfig | null {
    const config = this.load();

    switch (config.platform) {
      case 'trello':
        return config.trello;
      case 'jira':
        return config.jira;
      case 'linear':
        return config.linear;
      default:
        return null;
    }
  }

  /**
   * Get all roles.
   */
  getRoles(): Record<string, RoleConfig> {
    return this.load().roles;
  }

  /**
   * Add or update a role.
   */
  setRole(name: string, role: RoleConfig): void {
    const config = this.load();
    config.roles[name] = role;
    this.save(config);
  }

  /**
   * Remove a role.
   */
  removeRole(name: string): boolean {
    const config = this.load();
    if (name in config.roles) {
      delete config.roles[name];
      this.save(config);
      return true;
    }
    return false;
  }

  /**
   * Get all projects.
   */
  getProjects(): Record<string, ProjectConfig> {
    return this.load().projects;
  }

  /**
   * Get a project by name.
   */
  getProject(name: string): ProjectConfig | undefined {
    return this.load().projects[name];
  }

  /**
   * Add or update a project.
   */
  setProject(name: string, project: ProjectConfig): void {
    const config = this.load();
    config.projects[name] = project;
    this.save(config);
  }

  /**
   * Remove a project.
   */
  removeProject(name: string): boolean {
    const config = this.load();
    if (name in config.projects) {
      delete config.projects[name];
      this.save(config);
      return true;
    }
    return false;
  }

  /**
   * Find projects that match a label.
   * Labels map directly to project names.
   */
  getProjectsForLabels(labels: string[]): ProjectConfig[] {
    const projects = this.getProjects();
    const matchedProjects: ProjectConfig[] = [];

    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      // Check if label matches a project name
      for (const [projectName, project] of Object.entries(projects)) {
        if (projectName.toLowerCase() === normalizedLabel) {
          if (!matchedProjects.find(p => p.name === project.name)) {
            matchedProjects.push(project);
          }
        }
      }
    }

    return matchedProjects;
  }

  /**
   * Find a role that can handle the given labels.
   * Returns the first role that handles any of the labels.
   */
  findRoleForLabels(labels: string[]): RoleConfig | undefined {
    const roles = Object.values(this.getRoles()).filter(r => r.enabled);
    const normalizedLabels = labels.map(l => l.toLowerCase());

    for (const role of roles) {
      const roleLabels = role.labels.map(l => l.toLowerCase());
      // Check if any of the card's labels match this role's labels
      if (normalizedLabels.some(label => roleLabels.includes(label))) {
        return role;
      }
    }

    return undefined;
  }

  /**
   * Check if a role can work on a project.
   */
  canRoleWorkOnProject(role: RoleConfig, projectName: string): boolean {
    // "*" means role can work on all projects
    if (role.projects.includes('*')) {
      return true;
    }
    return role.projects.map(p => p.toLowerCase()).includes(projectName.toLowerCase());
  }
}

// Singleton instance
export const configManager = new ConfigManager();
