# Boatclaw

AI-powered task automation for development teams.

Connect your project board to AI — tasks become pull requests automatically.

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

This uses Claude's MCP (Model Context Protocol) to enable the `ask_human` tool.

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

## Development

```bash
git clone https://github.com/AiondaDotCom/boatclaw.git
cd boatclaw
npm install
npm run build
npm link
```

## License

MIT

