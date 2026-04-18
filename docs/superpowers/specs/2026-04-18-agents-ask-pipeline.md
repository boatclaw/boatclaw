# `agents ask` Terminal Pipeline Runner

## Goal

Replace the current `agents ask` (raw Claude CLI session) with the full boatclaw pipeline running from the terminal. Same execution path as the board flow but with terminal as input/output instead of Jira/Trello/Linear.

## Flow

```
boatclaw agents ask [agent-name] [--pr] [--no-pr] [--review] [--no-review] [--project <name>]
```

1. Select agent (if name not provided, show picker)
2. Ask optional questions:
   - "Create PR?" (only if GitHub enabled, default: yes)
   - "Run review?" (default: yes)
3. Free text input for task description (multi-line, empty line to submit)
4. Execute via `TaskProcessor.processMultiProject()` — same code path as worker
5. Print per-project progress to terminal
6. Create PRs if requested
7. Run review if requested
8. Print final summary with PR links

## Architecture

No new files. Modify `src/cli/commands/agents.ts` — replace `askAgent()`.

### Data flow

```
Terminal input → fake Card → processMultiProject() → print to terminal
                                    ↓
                          same TaskProcessor the worker uses
                                    ↓
                          PRManager (if --pr)
                          ReviewerAgent (if --review)
```

### Fake Card object

Built from user's terminal input:
- `id`: `terminal-{timestamp}`
- `title`: first line of input
- `description`: full input text
- `labels`: from agent's configured labels
- `url`: empty string
- Other fields: sensible defaults

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--pr` / `--no-pr` | yes if GitHub enabled | Create PR from changes |
| `--review` / `--no-review` | yes | Run AI code review after |
| `--project <name>` | all agent projects | Limit to one project |

### Terminal output format

```
  Boatclaw started
  Agent: fullstack | Model: opus
  Projects: backend, frontend

  Planning...
  Order: backend → frontend

  [backend] Working...
  [backend] Done (45s) — PR: https://github.com/org/backend/pull/5

  [frontend] Working...
  [frontend] Done (32s) — PR: https://github.com/org/frontend/pull/12

  Review...
  [backend] Review passed
  [frontend] Review passed

  Task completed (77s)
  PRs: https://github.com/org/backend/pull/5
       https://github.com/org/frontend/pull/12
```

### What we reuse

- `TaskProcessor` + `createTaskProcessorFunction` — task execution
- `PRManager` + `WorktreeManager` — PR creation
- `ReviewerAgent` — code review
- `selectModel` — model selection
- `planTask` — multi-project planning

### What we DON'T do

- No board comments (no board)
- No card movement
- No comment re-fetching
- No MCP/ask_human (v1 — add later)
- No `onProjectComplete` board comments — print to terminal instead

### Error handling

- If AI execution fails: print error, continue to next project (same as worker)
- If PR creation fails: print error, still show results
- If review fails: print error, still show PR links
- Overall success = at least one project succeeded (same as worker)
