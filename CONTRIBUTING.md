# Contributing to Boatclaw

Thanks for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/boatclaw.git
   cd boatclaw
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/boatclaw/boatclaw.git
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Create a branch:
   ```bash
   git checkout -b feature/your-feature
   ```

## Development

```bash
npm run build      # Build the project
npm run lint       # Run linter
npm run typecheck  # Type check
npm run dev        # Watch mode
```

### Project Structure

```
src/
├── ai/           # AI providers (Claude, Cursor, Codex)
├── cli/          # CLI commands and UI
├── core/         # Config, logging, errors
├── github/       # GitHub integration
├── mcp/          # MCP server for ask_human
└── platforms/    # Board providers (Trello, Jira, Linear)
```

## Pull Requests

1. Keep changes focused and atomic
2. Update documentation if needed
3. Ensure CI passes (lint, typecheck, build)
4. Write clear commit messages

## Commit Messages

Use conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `chore:` Maintenance

## Code Style

- TypeScript strict mode
- ESLint + Prettier formatting
- Clear function/variable names
- Comments for complex logic only

## Reporting Bugs

Found a bug? [Open an issue](https://github.com/boatclaw/boatclaw/issues/new?template=bug_report.md) with steps to reproduce.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Questions?

Open an [issue](https://github.com/boatclaw/boatclaw/issues) or start a discussion.
