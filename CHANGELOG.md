# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2024-04-12

### Added
- Initial release
- **Board Providers**
  - Trello integration
  - Jira integration
  - Linear integration
- **AI Providers**
  - Claude Code (with interactive mode)
  - Cursor CLI
  - OpenAI Codex
- **Interactive Mode** (Claude only)
  - `ask_human` MCP tool for asking questions via comments
  - `post_update` tool for progress updates
  - Automatic answer detection from replies
- **CLI**
  - `boatclaw setup` - Interactive setup wizard
  - `boatclaw start` - Start the worker
  - `boatclaw status` - View configuration
  - `boatclaw projects` - Manage projects
  - `boatclaw agents` - Manage AI agents
  - `boatclaw reset` - Reset configuration
- **Features**
  - Multi-project support (one card → multiple repos)
  - Role-based task assignment via labels
  - Automatic PR creation (GitHub)
  - Configurable workflow states
