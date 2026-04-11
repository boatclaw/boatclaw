# Boatclaw

AI-powered task automation for development teams.

Connect your Trello board to Claude AI — tasks become pull requests automatically.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

**[boatclaw.dev](https://boatclaw.dev)**

---

## How it works

```
Trello Card  →  Claude AI  →  GitHub PR
```

1. Create a card in your "Open" list
2. Boatclaw picks it up, moves to "In Progress"
3. Claude AI implements the task
4. Pull request created automatically
5. Card moves to "Done"

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
- [Claude Code](https://claude.ai/code) installed and authenticated
- Trello API credentials
- GitHub token (for PRs)

## Commands

```bash
boatclaw setup              # Setup wizard
boatclaw status             # View configuration
boatclaw start              # Start worker
boatclaw start --dry-run    # Test mode

boatclaw projects           # Manage projects
boatclaw agents             # Manage AI agents
boatclaw context            # Manage AI context

boatclaw github setup       # Configure GitHub
```

## Configuration

All config stored in `~/.boatclaw/config.yaml`

### Projects

Your codebases that agents work on:
- Local path
- GitHub repo (owner/repo)
- Context (tech stack, conventions)

### Agents

AI workers that pick up tasks:
- Labels they respond to
- Model (haiku/sonnet/opus/auto)
- Context (coding preferences)

### Workflow

Map Trello lists to stages:
- **Open** → Trigger list (tasks picked up here)
- **In Progress** → Working list
- **Review** → PR created
- **Done** → Completed
- **Failed** → Error occurred

## Example

```bash
# Setup your board and projects
boatclaw setup

# Start watching for tasks
boatclaw start
```

Create a Trello card:
> **Title:** Add login page
> **Label:** frontend

Boatclaw will:
1. Move card to "In Progress"
2. Run Claude on your frontend repo
3. Create a PR with the implementation
4. Move card to "Review"

## Development

```bash
git clone https://github.com/boatclaw/boatclaw.git
cd boatclaw
npm install
npm run build
npm link
```

## License

MIT © [Boatclaw](https://boatclaw.dev)
