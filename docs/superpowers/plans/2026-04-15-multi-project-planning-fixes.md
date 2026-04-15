# Multi-Project Planning Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 issues in boatclaw's multi-project planning feature so that comments are the primary knowledge channel between project sessions, plans are transparent, and the system handles failures intelligently.

**Architecture:** Callback-based comment re-fetching injected from worker into task-processor to keep module boundaries clean. Planner gains configurable model. Worker posts plan decisions to ticket. Task processor aborts dependent projects on failure. Review phase respects planning scope.

**Tech Stack:** TypeScript, Zod schemas, existing BoardProvider/AIProvider interfaces

---

### Task 1: Add `fetchComments` callback to task-processor and re-fetch before each project [HIGH]

The task-processor needs to re-fetch ticket comments before each project session so that per-project update comments posted after earlier projects are visible to later projects.

**Files:**
- Modify: `src/ai/task-processor.ts:148-157` (processMultiProject options)
- Modify: `src/ai/task-processor.ts:197-257` (per-project loop)

- [ ] **Step 1: Add `fetchComments` to processMultiProject options**

In `src/ai/task-processor.ts`, add the callback to the options type at line 148:

```typescript
  async processMultiProject(
    card: Card,
    role: RoleConfig,
    projects: ProjectConfig[],
    options?: {
      additionalInstructions?: string;
      cardComments?: string;
      dryRun?: boolean;
      onProjectComplete?: (result: ProjectProcessingResult) => void;
      /** Callback to re-fetch fresh comments from the ticket. Called before each project session. */
      fetchComments?: (cardId: string) => Promise<string | undefined>;
    }
  ): Promise<TaskProcessingResult> {
```

- [ ] **Step 2: Re-fetch comments before each project in the loop**

In the `for (const project of projectsToProcess)` loop (line 197), add comment re-fetching at the top of the loop body, right after the `log.info` call at line 198. Replace the static `options?.cardComments` usage with fresh comments:

```typescript
    for (const project of projectsToProcess) {
      log.info(`Processing project: ${project.name}`, { cardId: card.id });

      // Re-fetch comments before each project session to include updates from previous projects
      let currentComments = options?.cardComments;
      if (options?.fetchComments && previousResults.length > 0) {
        try {
          const freshComments = await options.fetchComments(card.id);
          if (freshComments) {
            currentComments = freshComments;
          }
        } catch {
          log.debug('Failed to re-fetch comments, using existing', { cardId: card.id });
        }
      }
```

Then update the `processProject` call at line 227 to use `currentComments` instead of `options`:

```typescript
      const projectResult = await this.processProject(
        card,
        role,
        project,
        { ...options, additionalInstructions: planInstructions, cardComments: currentComments }
      );
```

Note: the existing spread `{ ...options, additionalInstructions: planInstructions }` already replaces `additionalInstructions`. We now also explicitly replace `cardComments` with `currentComments`.

- [ ] **Step 3: Commit**

```bash
git add src/ai/task-processor.ts
git commit -m "fix: re-fetch ticket comments before each project session

Comments are now refreshed between project sessions so that updates
posted after earlier projects complete are visible to later projects.
Uses a callback to keep task-processor decoupled from board provider."
```

---

### Task 2: Create `fetchComments` callback in worker and pass to task processor [HIGH]

The worker owns the BoardProvider and the bot-comment filtering logic. Extract this into a reusable callback and pass it to the task processor.

**Files:**
- Modify: `src/core/worker.ts:365-443` (processTask method)

- [ ] **Step 1: Extract comment-fetching into a helper method on Worker**

Add a new private method to the Worker class, after the `moveCardToWorking` method (after line 530):

```typescript
  /**
   * Fetch human comments from a card, filtering out bot comments.
   * Returns formatted string or undefined if no human comments.
   */
  private async fetchHumanComments(cardId: string): Promise<string | undefined> {
    const comments = await this.provider.getComments(cardId);
    const humanComments = comments.filter(c => {
      const t = c.text;
      return !t.includes('**Boatclaw') &&
        !t.includes('**Task completed') &&
        !t.includes('**Task failed') &&
        !t.includes('**Code review') &&
        !t.includes('**Review passed') &&
        !t.includes('**Review found') &&
        !t.includes('**Automated review');
    });
    if (humanComments.length === 0) return undefined;
    return humanComments
      .map(c => `**${c.authorName}** (${c.createdAt.toISOString().split('T')[0]}):\n${c.text}`)
      .join('\n\n---\n\n')
      .slice(0, 5000);
  }
```

- [ ] **Step 2: Use the helper in processTask and pass as callback**

Replace the inline comment-fetching block in `processTask` (lines 385-406) with a call to the new helper:

```typescript
      // Fetch card comments for context (human discussion, follow-ups)
      // Done BEFORE the started comment so planning can use them
      let cardComments: string | undefined;
      try {
        cardComments = await this.fetchHumanComments(card.id);
      } catch {
        // Ignore comment fetch errors — not critical
      }
```

Then update the `taskProcessor` call (line 418) to pass the `fetchComments` callback. Since the per-project callback also needs to change (Task 3 handles awaiting), for now just add the fetchComments:

The current callback at line 418-443 is passed inline. We need to restructure so that `fetchComments` is also passed. The task processor function type in worker.ts (line 81-93) needs updating first.

Update the `TaskProcessor` type (line 81-93) to accept `fetchComments`:

```typescript
export type TaskProcessor = (
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  onProjectComplete?: (result: ProjectProcessingNotification) => void,
  cardComments?: string,
  fetchComments?: (cardId: string) => Promise<string | undefined>,
) => Promise<{
  success: boolean;
  output: string;
  summary?: string;
  error?: string;
  projectResults?: ProjectResult[];
}>;
```

Update the `taskProcessor` call in `processTask` (line 418) to pass the callback:

```typescript
      const processingResult = await this.taskProcessor(card, role, projects, (projectResult) => {
        // ... existing per-project callback unchanged for now ...
      }, cardComments, (cardId) => this.fetchHumanComments(cardId));
```

- [ ] **Step 3: Update createTaskProcessorFunction to accept and forward fetchComments**

In `src/ai/task-processor.ts`, update `createTaskProcessorFunction` (line 492-529) to accept the new parameter:

```typescript
  return async (card, role, projects, onProjectComplete, cardComments, fetchComments) => {
    const result = await processor.processMultiProject(card, role, projects, {
      dryRun: options?.dryRun,
      cardComments,
      fetchComments,
      onProjectComplete: onProjectComplete || options?.onProjectComplete,
    });
```

- [ ] **Step 4: Update defaultTaskProcessor signature**

In `src/core/worker.ts`, update the default task processor (line 113) to match the new signature:

```typescript
const defaultTaskProcessor: TaskProcessor = async (card, role, projects, _onProjectComplete, _cardComments, _fetchComments) => {
```

- [ ] **Step 5: Commit**

```bash
git add src/core/worker.ts src/ai/task-processor.ts
git commit -m "fix: wire fetchComments callback from worker to task-processor

Worker creates a fetchComments callback wrapping BoardProvider.getComments
with bot-comment filtering. Passed through to task-processor so comments
can be re-fetched between project sessions."
```

---

### Task 3: Await per-project comment posting [HIGH]

The per-project update comments are posted fire-and-forget. They must be awaited so that re-fetched comments in the next project session include them.

**Files:**
- Modify: `src/core/worker.ts:418-443` (per-project callback in processTask)
- Modify: `src/core/worker.ts:81-93` (TaskProcessor type — onProjectComplete becomes async)
- Modify: `src/ai/task-processor.ts:148-157` (onProjectComplete type)
- Modify: `src/ai/task-processor.ts:246-249` (await the callback)

- [ ] **Step 1: Make onProjectComplete async in types**

In `src/core/worker.ts`, update `TaskProcessor` type's callback to return a Promise:

```typescript
export type TaskProcessor = (
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  onProjectComplete?: (result: ProjectProcessingNotification) => Promise<void> | void,
  cardComments?: string,
  fetchComments?: (cardId: string) => Promise<string | undefined>,
) => Promise<{
  success: boolean;
  output: string;
  summary?: string;
  error?: string;
  projectResults?: ProjectResult[];
}>;
```

In `src/ai/task-processor.ts`, update the `processMultiProject` options type:

```typescript
      onProjectComplete?: (result: ProjectProcessingResult) => Promise<void> | void;
```

- [ ] **Step 2: Await the callback in task-processor**

In `src/ai/task-processor.ts`, update the callback invocation at line 248:

```typescript
      // Notify caller after each project completes
      if (options?.onProjectComplete) {
        await options.onProjectComplete(projectResult);
      }
```

- [ ] **Step 3: Make the worker's inline callback async and await addComment**

In `src/core/worker.ts`, change the callback at line 418 from fire-and-forget to awaited:

```typescript
      const processingResult = await this.taskProcessor(card, role, projects, async (projectResult) => {
        if (!this.dryRun && projects.length > 1) {
          const status = projectResult.success ? '✅' : '❌';
          let msg = `${status} **${projectResult.projectName}** — ${projectResult.success ? 'completed' : 'failed'}`;
          if (projectResult.prUrl) {
            msg += ` — [PR #${projectResult.prNumber}](${projectResult.prUrl})`;
          }
          if (projectResult.error) {
            msg += `\n> ${projectResult.error}`;
          }
          // Include structured summary or brief output snippet
          if (projectResult.output) {
            const summaryMatch = projectResult.output.match(/<!-- BOATCLAW_SUMMARY_START -->([\s\S]*?)<!-- BOATCLAW_SUMMARY_END -->/);
            const legacyMatch = projectResult.output.match(/\*\*What was done:?\*\*[\s\S]*?^---$/im);
            const match = summaryMatch || legacyMatch;
            if (match) {
              msg += `\n\n${(summaryMatch ? summaryMatch[1] : match[0]).trim()}`;
            } else {
              const lines = projectResult.output.split('\n').filter(l => l.trim()).slice(-5);
              if (lines.length > 0) {
                msg += `\n\n**Output:**\n${lines.join('\n').slice(0, 500)}`;
              }
            }
          }
          try {
            await this.provider.addComment(card.id, msg);
          } catch {
            log.debug('Failed to post per-project update', { cardId: card.id, project: projectResult.projectName });
          }
        }
      }, cardComments, (cardId) => this.fetchHumanComments(cardId));
```

- [ ] **Step 4: Commit**

```bash
git add src/core/worker.ts src/ai/task-processor.ts
git commit -m "fix: await per-project comment posting for reliable re-fetching

Per-project update comments are now awaited so they are guaranteed to
be persisted before the next project session re-fetches comments."
```

---

### Task 4: Post plan reasoning to ticket [MEDIUM]

After the planning phase, post the plan decision as a ticket comment so users can see what the planner decided.

**Files:**
- Modify: `src/ai/task-processor.ts:175-192` (after planTask call)

- [ ] **Step 1: Add `postComment` callback to processMultiProject options**

The task processor already has `onProjectComplete` for per-project updates. Add a `postComment` callback for general comments:

```typescript
    options?: {
      additionalInstructions?: string;
      cardComments?: string;
      dryRun?: boolean;
      onProjectComplete?: (result: ProjectProcessingResult) => Promise<void> | void;
      fetchComments?: (cardId: string) => Promise<string | undefined>;
      /** Post a comment to the ticket (for plan updates, etc.) */
      postComment?: (cardId: string, text: string) => Promise<void>;
    }
```

- [ ] **Step 2: Post plan after planning phase**

In `processMultiProject`, after the planning block (after line 191), add:

```typescript
      // Post plan decision to ticket for transparency
      if (plan && options?.postComment) {
        const skipped = projects
          .filter(p => !plan.projects.some(pp => pp.toLowerCase() === p.name.toLowerCase()))
          .map(p => p.name);

        let planMsg = `📋 **Planning complete**\n\n**Scope:** ${plan.scope}\n**Order:** ${plan.projects.join(' → ')}`;
        if (skipped.length > 0) {
          planMsg += `\n**Skipped:** ${skipped.join(', ')}`;
        }
        if (plan.sharedContracts) {
          planMsg += `\n**Shared contracts:** Yes — will abort remaining projects if a dependency fails`;
        }
        planMsg += `\n**Reasoning:** ${plan.reasoning}`;
        if (plan.executionNotes) {
          planMsg += `\n**Notes:** ${plan.executionNotes}`;
        }

        try {
          await options.postComment(card.id, planMsg);
        } catch {
          log.debug('Failed to post plan comment', { cardId: card.id });
        }
      }
```

- [ ] **Step 3: Wire postComment from worker**

In `src/core/worker.ts`, update the `TaskProcessor` type to add `postComment`:

```typescript
export type TaskProcessor = (
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  onProjectComplete?: (result: ProjectProcessingNotification) => Promise<void> | void,
  cardComments?: string,
  fetchComments?: (cardId: string) => Promise<string | undefined>,
  postComment?: (cardId: string, text: string) => Promise<void>,
) => Promise<{
  success: boolean;
  output: string;
  summary?: string;
  error?: string;
  projectResults?: ProjectResult[];
}>;
```

Update the `taskProcessor` call in `processTask` to pass postComment:

```typescript
      const processingResult = await this.taskProcessor(
        card, role, projects,
        async (projectResult) => { /* ... existing callback ... */ },
        cardComments,
        (cardId) => this.fetchHumanComments(cardId),
        async (cardId, text) => { await this.provider.addComment(cardId, text); },
      );
```

Update `createTaskProcessorFunction` to forward `postComment`:

```typescript
  return async (card, role, projects, onProjectComplete, cardComments, fetchComments, postComment) => {
    const result = await processor.processMultiProject(card, role, projects, {
      dryRun: options?.dryRun,
      cardComments,
      fetchComments,
      postComment,
      onProjectComplete: onProjectComplete || options?.onProjectComplete,
    });
```

Update `defaultTaskProcessor` signature:

```typescript
const defaultTaskProcessor: TaskProcessor = async (card, role, projects, _onProjectComplete, _cardComments, _fetchComments, _postComment) => {
```

- [ ] **Step 4: Commit**

```bash
git add src/ai/task-processor.ts src/core/worker.ts
git commit -m "feat: post plan reasoning to ticket for transparency

After the planning phase, a comment is posted showing which projects
will be worked on, in what order, and why. Skipped projects are listed."
```

---

### Task 5: Abort on cross-project dependency failure [MEDIUM]

When the planner says `sharedContracts: true` and `scope: 'cross-project'`, if a project fails, skip remaining projects since they depend on the failed one.

**Files:**
- Modify: `src/ai/task-processor.ts:197-257` (per-project loop)

- [ ] **Step 1: Add abort logic to the per-project loop**

After the project result is recorded (after the `if (projectResult.success)` / `else` block around line 252-256), add:

```typescript
      if (projectResult.success) {
        hasAnySuccess = true;
      } else {
        hasAnyFailure = true;

        // Abort remaining projects if this is a cross-project task with shared contracts
        // and a dependency failed — subsequent projects would be working with incomplete context
        if (plan?.scope === 'cross-project' && plan?.sharedContracts) {
          log.warn('Aborting remaining projects due to dependency failure', {
            failedProject: project.name,
            remainingProjects: projectsToProcess.slice(projectsToProcess.indexOf(project) + 1).map(p => p.name).join(', '),
          });

          // Notify about abort via comment
          if (options?.postComment) {
            const remaining = projectsToProcess.slice(projectsToProcess.indexOf(project) + 1).map(p => p.name);
            if (remaining.length > 0) {
              try {
                await options.postComment(card.id,
                  `⚠️ **Aborting remaining projects** (${remaining.join(', ')})\n\n` +
                  `**${project.name}** failed and has shared contracts with downstream projects. ` +
                  `Continuing would produce incompatible changes.`
                );
              } catch { /* ignore */ }
            }
          }
          break;
        }
      }
```

- [ ] **Step 2: Commit**

```bash
git add src/ai/task-processor.ts
git commit -m "fix: abort remaining projects on cross-project dependency failure

When the planner indicates shared contracts between projects and one
fails, subsequent projects are skipped to prevent incompatible changes."
```

---

### Task 6: Review phase respects planning scope [MEDIUM]

The review phase currently reviews all projects for a role, ignoring which ones the planner selected. Fix this by tracking planned projects and filtering during review.

**Files:**
- Modify: `src/core/worker.ts:451-458` (handleTaskSuccess — pass planned projects info)
- Modify: `src/core/worker.ts:674-795` (reviewCard — filter by planned projects)

- [ ] **Step 1: Include planned project names in the success comment**

In `handleTaskSuccess` (line 535), the comment already lists project results. Add a machine-readable marker so the reviewer can extract which projects were planned:

In the success comment building (around line 548), add after the PR links section:

```typescript
    // Add planned projects marker for review phase (machine-readable)
    if (projectResults && projectResults.length > 0) {
      const plannedNames = projectResults.map(r => r.projectName).join(',');
      parts.push(`<!-- BOATCLAW_PLANNED_PROJECTS:${plannedNames} -->`);
    }
```

- [ ] **Step 2: Filter review to only planned projects**

In `reviewCard` (line 674), after getting `roleProjects` and the PR comment, extract the planned projects marker:

```typescript
      // Extract planned projects from the completion comment (if planner was used)
      let plannedProjectNames: string[] | null = null;
      if (agentCompletionComment?.text) {
        const plannedMatch = agentCompletionComment.text.match(/<!-- BOATCLAW_PLANNED_PROJECTS:(.+?) -->/);
        if (plannedMatch) {
          plannedProjectNames = plannedMatch[1].split(',').map(n => n.trim());
        }
      }
```

Then in the local review section (line 763), filter projects:

```typescript
        // Local mode: review each project's changes with error isolation
        let projectsToReview = roleProjects.length > 0 ? roleProjects : (project ? [project] : []);

        // Filter to only planned projects if planner was used
        if (plannedProjectNames) {
          projectsToReview = projectsToReview.filter(p =>
            plannedProjectNames!.some(name => name.toLowerCase() === p.name.toLowerCase())
          );
        }
```

- [ ] **Step 3: Commit**

```bash
git add src/core/worker.ts
git commit -m "fix: review phase only reviews projects that were in the plan

A machine-readable marker in the completion comment tells the reviewer
which projects were planned. Unplanned projects are skipped in review."
```

---

### Task 7: Tagged delimiters for summary extraction [LOW]

Add `<!-- BOATCLAW_SUMMARY_START/END -->` delimiters to the prompt template. Update extraction to look for these first, fallback to the current regex.

**Files:**
- Modify: `src/ai/prompt-builder.ts:170-201` (buildFinalSection)
- Modify: `src/ai/task-processor.ts:238-245` (summary extraction in processMultiProject)
- Modify: `src/ai/task-processor.ts:438-462` (extractSummary method)

- [ ] **Step 1: Add delimiters to the prompt template**

In `src/ai/prompt-builder.ts`, update `buildFinalSection` (line 172). Wrap the summary template with delimiters:

```typescript
function buildFinalSection(context: TaskContext): string {
  const isCrossProject = context.additionalInstructions?.includes('cross-project task');

  let summaryTemplate = `<!-- BOATCLAW_SUMMARY_START -->
---
**What was done:** Brief description of the implementation
**Files changed:**
- path/to/file1.ts — what was changed
- path/to/file2.ts — what was changed`;

  if (isCrossProject) {
    summaryTemplate += `
**API contracts added/changed:** (list any new or modified endpoints, request/response shapes, interfaces, schemas — or "None")`;
  }

  summaryTemplate += `
**Blockers:** Any issues encountered or things that couldn't be completed (or "None")
**Notes:** Anything the reviewer should know (or "None")
---
<!-- BOATCLAW_SUMMARY_END -->`;

  return `## Your Task

Now implement the task described above. Start by exploring the relevant parts of the codebase, then make the necessary changes.

## Completion Summary

When you're done, end your response with a summary in this format:

${summaryTemplate}`;
}
```

- [ ] **Step 2: Update summary extraction in processMultiProject**

In `src/ai/task-processor.ts`, update the summary extraction at line 240:

```typescript
      if (projectResult.success) {
        // Try tagged delimiters first, then legacy regex, then fallback
        const taggedMatch = projectResult.output.match(/<!-- BOATCLAW_SUMMARY_START -->([\s\S]*?)<!-- BOATCLAW_SUMMARY_END -->/);
        const legacyMatch = projectResult.output.match(/\*\*What was done:?\*\*[\s\S]*?^---$/im);
        const summary = taggedMatch
          ? taggedMatch[1].trim()
          : legacyMatch
            ? legacyMatch[0].trim()
            : projectResult.output.slice(-2000).trim();
        previousResults.push({ name: project.name, summary });
      }
```

- [ ] **Step 3: Update extractSummary method**

In `src/ai/task-processor.ts`, update `extractSummary` (line 438):

```typescript
  private extractSummary(output: string): string {
    // Try tagged delimiters first
    const taggedMatch = output.match(/<!-- BOATCLAW_SUMMARY_START -->([\s\S]*?)<!-- BOATCLAW_SUMMARY_END -->/);
    if (taggedMatch) {
      return taggedMatch[1].trim().slice(0, 2000);
    }

    // Legacy: try structured completion summary
    const structuredMatch = output.match(/\*\*What was done:?\*\*[\s\S]*?^---$/im);
    if (structuredMatch) {
      return structuredMatch[0].trim().slice(0, 2000);
    }

    // Fallback: look for common summary patterns
    const patterns = [
      /summary:?\s*(.+?)(?:\n|$)/i,
      /changes?:?\s*(.+?)(?:\n|$)/i,
      /implemented:?\s*(.+?)(?:\n|$)/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1].trim().slice(0, 200);
      }
    }

    // Return first non-empty line
    const lines = output.split('\n').filter((l) => l.trim());
    return lines[0]?.trim().slice(0, 200) || 'Task completed';
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/ai/prompt-builder.ts src/ai/task-processor.ts
git commit -m "fix: add tagged delimiters for reliable summary extraction

Prompts now include BOATCLAW_SUMMARY_START/END markers. Extraction
checks for these first, falls back to legacy regex for compatibility."
```

---

### Task 8: Complete bot comment filter [LOW]

Add per-project update patterns to the bot comment filter so they are excluded when fetching human-only comments.

**Files:**
- Modify: `src/core/worker.ts` (fetchHumanComments method — created in Task 2)

- [ ] **Step 1: Add per-project update patterns to the filter**

In the `fetchHumanComments` method (created in Task 2), add patterns for per-project status updates and planning comments:

```typescript
  private async fetchHumanComments(cardId: string): Promise<string | undefined> {
    const comments = await this.provider.getComments(cardId);
    const humanComments = comments.filter(c => {
      const t = c.text;
      return !t.includes('**Boatclaw') &&
        !t.includes('**Task completed') &&
        !t.includes('**Task failed') &&
        !t.includes('**Code review') &&
        !t.includes('**Review passed') &&
        !t.includes('**Review found') &&
        !t.includes('**Automated review') &&
        // Per-project status updates
        !t.startsWith('✅ **') &&
        !t.startsWith('❌ **') &&
        // Planning comments
        !t.includes('**Planning complete**') &&
        // Abort notices
        !t.includes('**Aborting remaining projects**') &&
        // Machine-readable markers
        !t.includes('<!-- BOATCLAW_PLANNED_PROJECTS:');
    });
    if (humanComments.length === 0) return undefined;
    return humanComments
      .map(c => `**${c.authorName}** (${c.createdAt.toISOString().split('T')[0]}):\n${c.text}`)
      .join('\n\n---\n\n')
      .slice(0, 5000);
  }
```

- [ ] **Step 2: Also update the review comment filter**

In `reviewCard` (line 700-711), add the same patterns to the review's human comment filter:

```typescript
      const humanComments = comments.filter(c => {
          const t = c.text;
          return !t.includes('**Boatclaw') &&
            !t.includes('**Task completed') &&
            !t.includes('**Task failed') &&
            !t.includes('**Code review') &&
            !t.includes('**Review passed') &&
            !t.includes('**Review found') &&
            !t.includes('**Automated review') &&
            !t.startsWith('✅ **') &&
            !t.startsWith('❌ **') &&
            !t.includes('**Planning complete**') &&
            !t.includes('**Aborting remaining projects**') &&
            !t.includes('<!-- BOATCLAW_PLANNED_PROJECTS:');
        });
```

- [ ] **Step 3: Commit**

```bash
git add src/core/worker.ts
git commit -m "fix: filter per-project updates and plan comments from human comments

Bot comment filter now excludes per-project status updates, planning
comments, abort notices, and machine-readable markers."
```

---

### Task 9: Forward `additionalInstructions` in createTaskProcessorFunction [LOW]

**Files:**
- Modify: `src/ai/task-processor.ts:492-529` (createTaskProcessorFunction)

- [ ] **Step 1: Pass additionalInstructions through**

In `createTaskProcessorFunction`, update the return function to include `additionalInstructions` from options:

```typescript
  return async (card, role, projects, onProjectComplete, cardComments, fetchComments, postComment) => {
    const result = await processor.processMultiProject(card, role, projects, {
      additionalInstructions: options?.additionalInstructions,
      dryRun: options?.dryRun,
      cardComments,
      fetchComments,
      postComment,
      onProjectComplete: onProjectComplete || options?.onProjectComplete,
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/ai/task-processor.ts
git commit -m "fix: forward additionalInstructions in createTaskProcessorFunction"
```

---

### Task 10: Make planner model configurable [LOW]

**Files:**
- Modify: `src/ai/planner.ts:165-224` (planTask function)
- Modify: `src/core/config.ts:108-117` (AIConfigSchema)

- [ ] **Step 1: Add `plannerModel` to AIConfigSchema**

In `src/core/config.ts`, add the field to `AIConfigSchema` (line 108):

```typescript
export const AIConfigSchema = z.object({
  provider: AIProviderSchema.default('claude'),
  availableProviders: z.array(AIProviderSchema).optional(),
  defaultModel: ModelSchema.default('auto'),
  /** Model used for the planning phase in multi-project tasks */
  plannerModel: ModelSchema.default('haiku'),
  apiKey: z.string().optional(),
  timeoutSeconds: z.number().default(1800),
  /** Enable interactive mode (ask_human) - only works with Claude Code */
  interactive: z.boolean().default(false),
});
```

- [ ] **Step 2: Use configurable model in planTask**

In `src/ai/planner.ts`, update `planTask` to accept an optional model parameter and use it:

```typescript
export async function planTask(
  card: Card,
  role: RoleConfig,
  projects: ProjectConfig[],
  aiProvider: AIProvider,
  cardComments?: string,
  plannerModel?: string,
): Promise<TaskPlan> {
```

Update the execute call at line 190:

```typescript
    const result = await aiProvider.execute({
      prompt,
      workingDir: projects[0].path,
      model: (plannerModel || 'haiku') as 'haiku' | 'sonnet' | 'opus',
      timeoutMs: 60000,
    });
```

- [ ] **Step 3: Pass planner model from task-processor**

In `src/ai/task-processor.ts`, update the `planTask` call (line 176) to pass the configured model:

```typescript
    if (projects.length > 1) {
      const config = configManager.load();
      plan = await planTask(card, role, projects, this.baseProvider, options?.cardComments, config.ai.plannerModel);
```

Note: `configManager` is already imported in task-processor.ts.

- [ ] **Step 4: Commit**

```bash
git add src/core/config.ts src/ai/planner.ts src/ai/task-processor.ts
git commit -m "feat: make planner model configurable via ai.plannerModel

Defaults to 'haiku' for fast/cheap planning. Can be overridden in
config.yaml under ai.plannerModel."
```

---

### Task 11: Fix codex type cast in checkAIAvailability [LOW]

**Files:**
- Modify: `src/ai/index.ts:188`

- [ ] **Step 1: Fix the type cast**

In `src/ai/index.ts`, update line 188:

```typescript
    const aiProvider = createAIProvider({
      provider: provider as 'claude' | 'cursor' | 'codex',
      defaultModel: 'sonnet',
      timeoutSeconds: 30,
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/ai/index.ts
git commit -m "fix: include codex in checkAIAvailability type cast"
```

---

## Self-Review Checklist

1. **Spec coverage:** All 10 issues covered. HIGH (Tasks 1-3), MEDIUM (Tasks 4-6), LOW (Tasks 7-11).
2. **Placeholder scan:** No TBDs, TODOs, or vague instructions. All steps have code.
3. **Type consistency:** `fetchComments` callback type matches across worker.ts TaskProcessor type, task-processor.ts options, and createTaskProcessorFunction. `postComment` callback added consistently. `onProjectComplete` updated to `Promise<void> | void` in both files.
