# Binaflow

## Product Goal

Binaflow is a local workflow orchestrator for coding agents. A workflow defines the work; external agent harnesses execute individual agent steps. The system must not depend on a specific CLI, model provider, or coding agent.

The initial product is intentionally small: a sequential `plan -> build` workflow. A planner produces a validated implementation plan, then a builder implements it. The workflow refers to logical agent profiles, not concrete models or harnesses.

## Architecture Principles

- Start as a modular monolith in TypeScript on Node.js.
- Prefer small, explicit modules over frameworks, dependency injection containers, or plugin systems.
- Keep the workflow engine independent from Pi, OpenCode, Codex, and future harnesses.
- Use a narrow `AgentDriver` contract to isolate each harness integration.
- Resolve harness, provider, model, permissions, and limits through external agent profiles.
- Persist workflow runs and step state in SQLite from the first implementation.
- Store large outputs as filesystem artifacts and persist their references in SQLite.
- Use versioned, serializable workflow definitions and structured intermediate outputs.
- Treat workflow definitions, agent profiles, and persisted runs as compatibility boundaries.
- Make the simplest correct change. Do not add abstractions before there is a concrete second use.

## Initial MVP Scope

Implement only the following capabilities:

- A TypeScript-authored, serializable workflow definition.
- Sequential agent steps with explicit dependencies and output references.
- External profiles for `planner` and `builder`.
- A `plan-build` workflow.
- JSON-schema validation for the planner output.
- SQLite-backed run and step persistence.
- Filesystem-backed artifacts.
- A JSONL process transport.
- Pi RPC as the first `AgentDriver`.
- CLI commands: `run`, `runs`, `show`, and `resume`.
- Basic timeout, cancellation, error recording, and step reuse on resume.

## Explicitly Out Of Scope

Do not implement items listed in `WISHLIST.md` unless the user explicitly moves them into `TODO.md`. In particular, do not add parallel execution, generic plugins, RAG, memory, voice, scheduled tasks, dynamic workflows, worktrees, a daemon, a TUI, remote workers, or drivers other than Pi during the MVP.

## Workflow And Agent Boundaries

- Workflows use logical profiles such as `planner` and `builder`.
- Workflows must not hard-code a harness, provider, or model unless a future requirement explicitly calls for a non-portable override.
- Profiles decide the driver, model, reasoning level, allowed tools, workspace mode, timeout, and retry policy.
- The planner is read-only and returns a compact structured plan.
- The builder receives the original objective and validated plan artifact, not the planner's entire transcript.
- The workflow engine consumes normalized driver events and results only. Driver-specific protocol details remain inside the driver.
- Do not assume every harness has the same capabilities. Add capability checks only when an actual second driver requires them.

## Session Protocol

At the start of every implementation session:

1. Read this file.
2. Read `TODO.md` completely.
3. Read `WISHLIST.md` for context only.
4. Implement only the active scope in `TODO.md`.
5. Update `TODO.md` as tasks are completed or newly discovered blockers arise.

Before ending an implementation session:

1. Run the relevant verification commands.
2. Mark only verified tasks as completed in `TODO.md`.
3. Record blockers, deviations, and follow-up tasks in `TODO.md`.
4. Keep future ideas in `WISHLIST.md`, not in the active implementation scope.

## Engineering Rules

- Use `AGENTS.md` as the project instruction file; Pi, OpenCode, Codex, and other coding agents can discover it.
- Prefer `pnpm` over `npm` for package management and project commands.
- Keep the code KISS: every module, abstraction, dependency, and line of code must have a concrete purpose in the active scope.
- Prioritize the Single Responsibility Principle: each module and function should have one clear reason to change, without splitting cohesive behavior into artificial layers.
- Introduce an architectural pattern only when its tradeoffs and current use justify it; do not build speculative abstractions.
- Keep the test suite intentionally small. Prefer a few behavior-focused tests that document important contracts and failure modes over coverage-driven tests.
- Every test must protect meaningful behavior or explain an important application flow. Do not add tests merely to cover lines, trivial accessors, implementation details, or equivalent permutations.
- Prefer ASCII in source and documentation unless Unicode has a clear purpose.
- Use JSON Schema for cross-step data contracts.
- Keep state transitions explicit: `pending`, `running`, `completed`, `failed`, `cancelled`, `interrupted`, or `skipped`.
- A completed step is reusable during resume only after its result and artifact references are persisted transactionally.
- A step interrupted by process termination is not completed and must be retried or explicitly handled by policy.
- Never silently rerun completed steps during resume.
- Avoid passing raw event logs or full agent transcripts into downstream prompts by default.
- Do not execute model-generated JavaScript or TypeScript as workflow orchestration code.
- Do not introduce distributed infrastructure, a remote plugin API, or a second implementation language without an explicit decision.

## Verification Expectations

- Add only the minimum valuable tests for workflow validation, output references, state transitions, and storage behavior; combine related behavior into readable scenarios when practical.
- Add focused driver contract tests using a fake JSONL process before relying on a local Pi installation.
- Keep live Pi integration tests optional and skipped when Pi or credentials are unavailable.
- Do not use coverage targets or test counts as quality goals.
- Run formatting, type checking, linting, and tests before declaring a TODO item complete.

---

name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
