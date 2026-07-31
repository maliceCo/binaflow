# Wishlist

This document records future directions only. None of these items are in the active MVP scope. Move an item to `TODO.md` only after an explicit product and architecture decision.

## Agent Harnesses

- Add OpenCode through an `AgentDriver`, initially using its non-interactive JSON output or server API.
- Add Codex through an `AgentDriver`, initially using `codex exec --json` or App Server.
- Add drivers for future coding-agent harnesses without changing the workflow engine.
- Add explicit driver capability discovery and workflow requirement validation when multiple drivers exist.
- Support session continuation, steering, native structured output, and usage reporting where a harness exposes them.

## Workflow Execution

- Add `parallel`, `map`, `condition`, `loop`, `approval`, `tool`, and `subworkflow` primitives.
- Extend the sequential engine into a DAG scheduler with bounded concurrency.
- Add worktree or isolated-workspace management for parallel editing agents.
- Add human approval between planning and implementation.
- Add automated model routing by capability, latency, and budget.
- Add per-run token, cost, agent-count, and execution-time budgets.
- Add planner-generated workflows validated against the same serializable workflow schema.
- Add adversarial review, voting, critic-reviser, planner-executor-verifier, and other reusable workflow patterns.

## Knowledge And Tools

- Add artifacts beyond JSON and text, including patches, test reports, and source citations.
- Add RAG and scoped memory as independent context providers.
- Add specialized web scraping, document ingestion, deduplication, and provenance tracking.
- Add MCP-backed tool integrations where an agent needs to choose and invoke a tool.
- Add deterministic native step handlers for operations that should not depend on model decisions.

## Interfaces And Triggers

- Add a long-running local daemon and make the CLI a client.
- Add a TUI or web interface for run progress and artifact inspection.
- Add HTTP APIs and webhooks.
- Add scheduled runs and event-based triggers.
- Add voice input and speech output as channels that preserve the normal permission model.
- Add chat integrations such as Slack or Teams.

## Security And Operations

- Add sandboxing and environment-secret isolation beyond harness-level permissions.
- Add audit trails, policy controls, and approval gates for destructive operations.
- Add read-only security analysis and authorized threat-hunting workflows using SIEM, EDR, logs, IOC feeds, and vulnerability data.
- Add remote workers, PostgreSQL, object storage, and distributed queues only after local execution has proven insufficient.

## Technology Reassessment

- Reassess Rust for a hardened single-binary daemon or high-control process manager if Node.js becomes a measured limitation.
- Reassess C# for an enterprise or Windows/Azure-centered deployment if the team and ecosystem make it advantageous.
- Preserve versioned workflow definitions and storage contracts so a runtime can be reimplemented without changing user workflows.
