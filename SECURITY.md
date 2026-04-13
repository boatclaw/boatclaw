# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Boatclaw, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **isializada@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce the issue
- Any potential impact

We will acknowledge your report within 48 hours and work with you to understand and address the issue.

## Scope

Security issues we care about:

- Credential exposure (API tokens, keys leaking to logs, output, or third parties)
- Command injection via card titles, descriptions, or labels
- Unauthorized access to local filesystem beyond configured project paths
- Vulnerabilities in the MCP server (ask_human tool)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Best Practices

When using Boatclaw:

- Store your `~/.boatclaw/config.yaml` with appropriate file permissions (it contains API tokens)
- Use GitHub Personal Access Tokens with minimal scopes (`repo`, `read:user`)
- Review AI-generated pull requests before merging
- Use `--dry-run` to test your setup before enabling live execution
