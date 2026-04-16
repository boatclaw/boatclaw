# Changelog

All notable changes to this project will be documented in this file.

## [0.4.6] - 2026-04-16

### Fixed
- Remote branch no longer deleted when a PR is created from it (was causing PRs to auto-close on GitHub)

## [0.4.5] - 2026-04-15

### Fixed
- Detect AI-committed changes when creating PRs — `hasChanges()` now checks for commits on the branch (not just uncommitted files), since AI agents like Claude commit changes themselves

## [0.4.4] - 2026-04-15

### Added
- **Multi-project planning** — new planning phase decides which projects need changes and in what order
- Plan reasoning posted to ticket for transparency
- Comments re-fetched between project sessions (cross-project context via comments)
- Cross-project dependency failure handling — abort remaining projects when shared contracts fail
- Tagged summary delimiters (`BOATCLAW_SUMMARY_START/END`) for reliable extraction
- Configurable planner model via `ai.plannerModel` (default: haiku)
- Review phase respects planning scope — only reviews projects that were planned

### Fixed
- `moveCard` return values now checked (prevents stuck cards)
- `processTask` fire-and-forget now has `.catch()` for unhandled rejections
- `findRoleForLabels` supports legacy `label` field (migration safety)
- `config set` validates values through Zod before saving
- Config parse errors now warn instead of silently returning defaults
- GitHub `merged` field bug (was always true on list endpoints)
- `getPullRequestFiles` now paginates (was dropping files beyond 100)
- Duplicate PR creation (422) finds and returns existing PR
- Async git diff in `reviewLocal` (no more blocking execSync)
- SIGKILL fallback 5s after SIGTERM in all AI providers
- Jira ADF comment rendering strips markdown for readable display
- MCP interactive mode comments now filtered from AI context
- Review phase has parallel limit, stop() has 5-minute timeout
- Empty review results auto-approve instead of failing
- CLI `isInitialized()` guards on context/agents/projects commands
- GitHub token validation accepts `ghs_`, `gho_`, `ghu_` prefixes

## [0.4.3] - 2026-04-15

### Fixed
- Better multi-project prompt handling
- Per-project summaries in comments
- Anchored regex for summary extraction

## [0.4.2] - 2026-04-15

### Fixed
- Aggregate multi-project review results
- Fix card movement between workflow lists

## [0.4.1] - 2026-04-15

### Fixed
- AI focuses only on current project in multi-project tasks

## [0.4.0] - 2026-04-15

### Added
- Multi-project workflow improvements
- Per-project result aggregation

## [0.1.2] - 2024-04-12

### Fixed
- npm publish with updated token configuration

## [0.1.1] - 2024-04-12

### Fixed
- Use PAT for release workflow pushes to avoid permission issues

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
