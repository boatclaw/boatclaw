# Boatclaw

AI-powered task automation for development teams.

Connect your project board to AI — tasks become pull requests automatically.

[![npm version](https://img.shields.io/npm/v/boatclaw.svg)](https://www.npmjs.com/package/boatclaw)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

**[boatclaw.dev](https://boatclaw.dev)**

---

## How it works

```
Board Card  →  AI Agent  →  GitHub PR
```

1. Create a card in your trigger list (e.g., "Todo")
2. Boatclaw picks it up, moves to "In Progress"
3. AI implements the task in your codebase
4. Pull request created automatically
5. Card moves to "Done"

## Supported Platforms

### Project Boards
- **Trello** - Kanban boards
- **Jira** - Atlassian projects
- **Linear** - Modern issue tracking

### AI Providers
- **Claude Code** - Full support with interactive mode
- **Cursor** - Basic support
- **Codex** - Basic support (OpenAI)

## Install

```bash
npm install -g boatclaw
```

## Quick Start

```bash
boatclaw setup     # Interactive setup wizard
boatclaw start     # Start the worker
```

## Requirements

- Node.js 18+
- AI CLI installed and authenticated:
  - [Claude Code](https://claude.ai/code) (recommended)
  - [Cursor](https://cursor.sh)
  - OpenAI API key (for Codex)
- Board API credentials (Trello/Jira/Linear)
- GitHub token (optional, for auto PR creation)

## Commands

```bash
boatclaw setup              # Setup wizard
boatclaw status             # View configuration
boatclaw start              # Start worker
boatclaw start --dry-run    # Test mode (no changes)
boatclaw start --interactive # Enable ask_human mode (Claude only)

boatclaw projects           # Manage projects
boatclaw agents             # Manage AI agents/roles
boatclaw context            # Manage AI context files

boatclaw github setup       # Configure GitHub integration
boatclaw reset              # Reset configuration
```

## Configuration

All config stored in `~/.boatclaw/config.yaml`

### Projects

Your codebases that agents work on:
- Local path to the repository
- GitHub repo (owner/repo) for PR creation
- Context file (e.g., CONTEXT.md with tech stack info)
- Base branch and branch prefix

### Agents (Roles)

AI workers that pick up tasks based on labels:
- **Labels** - Which card labels trigger this agent
- **Projects** - Which projects this agent can work on
- **Model** - AI model (haiku/sonnet/opus/auto)
- **Context** - Custom instructions for this agent

### Workflow

Map board lists/statuses to workflow stages:
- **Trigger** - Tasks picked up here (e.g., "Todo")
- **Working** - Currently being processed (e.g., "In Progress")
- **Review** - PR created, awaiting review (optional)
- **Success** - Completed successfully (e.g., "Done")
- **Failed** - Error occurred (e.g., "Canceled")

## Interactive Mode (Claude Code only)

When enabled, Claude can ask clarifying questions during task execution:

```bash
boatclaw start --interactive
```

How it works:
1. Claude encounters an ambiguous task
2. Posts a question as a comment on the ticket
3. Waits for your reply (comment starting with "Answer:")
4. Continues with your guidance

This uses Claude's MCP (Model Context Protocol) to enable two tools:
- `ask_human` - posts a question, waits for reply
- `post_update` - posts progress updates without blocking

## Example

```bash
# Setup your board and projects
boatclaw setup

# Start watching for tasks
boatclaw start
```

Create a card on your board:
> **Title:** Add user authentication
> **Label:** backend
> **Description:** Implement JWT-based auth for the API

Boatclaw will:
1. Move card to "In Progress"
2. Run AI on your backend project
3. Create a PR with the implementation
4. Add completion summary as comment
5. Move card to "Done"

## Multi-Project Support

One card can trigger work across multiple projects. Configure agents with:
```yaml
roles:
  fullstack:
    labels: [fullstack]
    projects: ['*']  # All projects
    model: opus
```

When an agent has 2+ projects, Boatclaw runs a **planning phase** before execution:

1. Analyzes the task to decide which projects actually need changes
2. Determines execution order (e.g., backend API first, then frontend)
3. Detects shared contracts/APIs between projects
4. Posts the plan to the ticket for transparency

**How context flows between projects:**
- Each project runs in its own session
- Before starting the next project, Boatclaw re-fetches ticket comments
- The previous project's completion summary is passed as context
- If a cross-project task has shared contracts and one project fails, remaining projects are aborted

**Planner model** — uses `haiku` by default (fast, cheap). Configurable:
```yaml
ai:
  plannerModel: haiku  # or sonnet, opus
```

## Review Phase

After task completion, cards move to the review list where an AI reviewer:
- Reviews the actual PR (if created) or local git diff
- Only reviews projects that were in the plan (not all role projects)
- Approves or requests changes
- Moves card to Done (approved) or Failed (rejected)

All projects must pass review for the card to reach Done.

## Vision

AI is getting good at writing code. What's missing is the automation around it — the glue between "here's what I want" and "here's your pull request."

Boatclaw is built on a simple belief: developers should focus on thinking, not typing. Describe what you want on your board, and AI agents handle the implementation. Today that means reviewing PRs. Tomorrow it means trusting the full pipeline — from idea to production.

We're working toward a world where one person with good ideas and clear thinking can do the work of an entire team. Not by working harder, but by letting AI handle the repetitive parts of building software.

## Roadmap

What we're working on next:

- [ ] Test suite — unit and integration tests for reliability
- [ ] Smarter context handling — auto-detect tech stack, read existing code patterns
- [ ] Webhook mode — real-time triggers instead of polling
- [ ] More AI providers — Gemini, GitHub Copilot
- [ ] More platforms — GitLab, Bitbucket, Asana, GitHub Projects
- [ ] Auto-review — AI reviews its own PRs before requesting human review
- [ ] Notifications — Slack, Discord, email updates on task progress
- [ ] Auto-merge — configurable trust levels for automatic merging
- [ ] Dashboard — web UI for monitoring agents and task history
- [ ] Multi-agent collaboration — agents that review each other's work

Have ideas? [Open an issue](https://github.com/boatclaw/boatclaw/issues).

## Development

```bash
git clone https://github.com/boatclaw/boatclaw.git
cd boatclaw
npm install
npm run build
npm link
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

To report a vulnerability, please see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

