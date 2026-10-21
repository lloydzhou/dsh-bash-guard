# Security and privacy

This is a preview application-policy plugin, not an OS sandbox or a complete security boundary. Activating it selects native Full access. Unsupported tools are not reviewed by this plugin. Child-session inheritance and PTC effective-permission consistency are not guaranteed.

## Reporting

Do not put credentials, private commands, session exports or confidential paths in public issues. If GitHub's **Security → Report a vulnerability** is available, use it for a private report. If unavailable, open a minimal issue requesting a private reporting channel without exploit details or sensitive data. A dedicated security response SLA is not offered.

## Jev data flow

Local mode makes no Jev requests. Enabling Jev for a session sends supported operations to the configured endpoint: FULL command text — including command substitutions, backticks and heredoc bodies — plus absolute workspace/working-directory/target paths, file-matching patterns, tool identifiers and permission bits. Write bodies, edit replacement text and grep search text are omitted. Embedded shell code can still contain private data; keyword screening is not comprehensive secret detection. Credential-shaped commands and oversized inputs are not sent — the local classifier decides them. Connection tests use a fixed synthetic operation.

## Audit log

The plugin appends a JSONL audit record locally (default `~/.dsh/bash-guard-audit.jsonl`; `auditLog` config or `BASH_GUARD_AUDIT_LOG` override). `audit: 'deny'` (default) records denied operations only; `audit: 'all'` also records allowed ones; `audit: 'off'` disables logging. Commands matching the sensitive pattern are recorded as `[SUPPRESSED]` — never plaintext. The log is best-effort: write failures are swallowed and never block execution. It contains command text and paths in plaintext; protect the file like any shell history. It is a tuning aid, not tamper-evident compliance logging.

API keys are stored as plaintext in the host's profile storage domain `bash_guard_jev`, not an encrypted vault. Public settings return only whether a key exists. The plugin does not independently guarantee underlying file permissions, ACLs, encrypted backups or host RPC access controls. Protect your OS account and profile directory; never commit/copy them into the repository. Clearing a key removes it from the active record, not necessarily backups, snapshots or memory; revoke it at the provider if exposed.

HTTPS is required except for loopback development endpoints. HTTP loopback endpoints cannot use remote proxies. Use trusted local proxies; a proxy controls connectivity and can observe destination/timing. TLS verification is not disabled. Endpoint changes require explicit key reentry. Arbitrary upstream bodies and error messages are not shown, only bounded diagnostic codes.

## Decision limitations

Jev is a probabilistic reviewer, not proof of safety. Each call is reviewed independently. API failures fall back to the local classifier, which can allow an operation that Jev might have denied. No confidence threshold is applied beyond response validation. Jev allow never overrides downstream native refusal. A local denial must not be worked around using a different tool.

## Release checks

Run `npm run build`, `npm test`, `npm audit --omit=dev`, and `npm pack --dry-run`. Review the allowlisted package contents and dependency licenses. Automated tests and pattern scans do not constitute a comprehensive security audit. Never publish genuine keys in test fixtures, logs, screenshots or Git history.
