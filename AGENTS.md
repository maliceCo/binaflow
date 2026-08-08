# Binaflow

## Product Goal

Binaflow is a local workflow orchestrator for coding agents. A workflow defines
the work; external agent harnesses execute individual agent steps. The system
must not depend on a specific CLI, model provider, or coding agent.

The product is intentionally small: a sequential `plan -> build` workflow and an
experimental `research-plan-build` workflow. Workflows refer to logical agent
profiles, not concrete models or harnesses.

## Architecture Principles

- Start as a modular monolith in TypeScript on Node.js.
- Prefer small, explicit modules over frameworks, dependency injection
  containers, or plugin systems.
- Prefer composition over inheritance. Use classes only for resources with
  identity or lifecycle, such as SQLite and child processes. Use inheritance only
  for idiomatic `Error` subclasses.
- Keep the workflow engine independent from Pi, OpenCode, Codex, and future
  harnesses.
- Use a narrow `AgentDriver` contract to isolate each harness integration.
- Resolve harness, provider, model, permissions, and limits through external
  agent profiles.
- Persist workflow runs and step state in SQLite.
- Store large outputs as filesystem artifacts and persist their references in
  SQLite.
- Use versioned, serializable workflow definitions and structured intermediate
  outputs.
- Treat workflow definitions, agent profiles, and persisted runs as compatibility
  boundaries.
- Make the simplest correct change. Do not add abstractions before there is a
  concrete second use.

## Dependency Direction

- `src/core` may depend on domain types and inward-facing ports only. It must not
  import CLI, TUI, concrete storage, filesystem artifacts, Pi, or concrete
  workflow modules.
- `src/application` composes use cases and workflow-specific coordination behind
  a narrow `ApplicationService` facade.
- CLI and TUI are presentation adapters. They depend on application operations
  and presentation helpers only. Neither may read SQLite, mutate engine state, or
  read artifact files directly.
- Storage, filesystem artifacts, and Pi remain replaceable adapters behind narrow
  consumer-owned contracts.
- Pi protocol details stay in the Pi driver and JSONL transport.
- Experimental research orchestration stays outside the generic sequential engine
  and must not be generalized into approval, loop, or DAG primitives.

## Lifecycle Ownership

- Every attached execution has one compositional lifecycle owner for the active
  controller, operation promise, event subscription, context ownership, and
  terminal exit.
- User cancellation, OS signals, stream failures, render failures, and normal
  completion share the same ordered shutdown path.
- The first cancellation request aborts gracefully. The second awaits cleanup
  before force signalling.
- Unmount or process cleanup must never close SQLite while execution or event
  persistence is active.
- At most one local process may execute or recover a given run at a time.
- Validation failures for resume and approval are non-mutating.
- Run status writes compare-and-set against the expected previous status.
- A completed step is reusable during resume only after its result and artifact
  references are persisted transactionally.
- Never silently rerun completed steps during resume.

## Current Product Scope

- TypeScript-authored, serializable workflow definitions.
- Sequential agent steps with explicit dependencies and output references.
- External profiles for `planner` and `builder`.
- A `plan-build` workflow.
- JSON-schema validation for planner output.
- SQLite-backed run and step persistence with filesystem artifacts.
- JSONL process transport and Pi RPC as the first `AgentDriver`.
- CLI commands including `run`, `runs`, `show`, `resume`, approval, artifacts,
  configuration, and update.
- Versioned JSON and JSONL CLI output for scripts and plugins.
- One attached Ink TUI under `src/tui` for human users.
- Experimental `research-plan-build` with its workflow-specific approval flow.

## Explicitly Out Of Scope

Do not implement items listed in `WISHLIST.md` unless the user explicitly promotes
them into active work. In particular, do not add parallel execution, generic
plugins, RAG, memory, voice, scheduled tasks, dynamic workflows, worktrees, a
daemon, remote workers, detached execution, generic approval/loop/DAG primitives,
or drivers other than Pi without an explicit decision.

The TUI must remain attached to the current process and must not introduce a
daemon or reconnection protocol.

## Workflow And Agent Boundaries

- Workflows use logical profiles such as `planner` and `builder`.
- Workflows must not hard-code a harness, provider, or model unless a future
  requirement explicitly calls for a non-portable override.
- Profiles decide the driver, model, reasoning level, allowed tools, workspace
  mode, timeout, and retry policy.
- The planner is read-only and returns a compact structured plan.
- The builder receives the original objective and validated plan artifact, not
  the planner's entire transcript.
- The workflow engine consumes normalized driver events and results only.
- A plugin invoking Binaflow through the CLI is different from Binaflow invoking
  a future OpenCode or Codex driver. Keep those integration directions separate.
- `research-plan-build` is experimental product functionality, not evidence that
  approval and loop primitives are generic workflow engine capabilities.

## Engineering Rules

- Use `AGENTS.md` as the project instruction file; Pi, OpenCode, Codex, and other
  coding agents can discover it.
- Prefer `pnpm` over `npm` for package management and project commands.
- Keep the code KISS: every module, abstraction, dependency, and line of code must
  have a concrete purpose.
- Prioritize the Single Responsibility Principle without splitting cohesive
  behavior into artificial layers.
- Keep the test suite intentionally small. Prefer a few behavior-focused tests
  that document important contracts and failure modes over coverage-driven tests.
- Every test must protect meaningful behavior or explain an important application
  flow. Do not add tests merely to cover lines, trivial accessors, implementation
  details, or equivalent permutations.
- Prefer ASCII in source and documentation unless Unicode has a clear purpose.
- Use JSON Schema for cross-step data contracts.
- Keep state transitions explicit: `pending`, `running`, `completed`, `failed`,
  `cancelled`, `interrupted`, `waiting`, or `skipped`.
- Avoid passing raw event logs or full agent transcripts into downstream prompts
  by default.
- Do not execute model-generated JavaScript or TypeScript as workflow
  orchestration code.
- Do not introduce distributed infrastructure, a remote plugin API, or a second
  implementation language without an explicit decision.
- Preserve protocol-v1 JSON and JSONL envelopes, fields, ordering, stream
  separation, and exit-code behavior.
- Preserve persisted-run compatibility. Use additive migrations when storage
  changes are required.
- Keep future ideas in `WISHLIST.md` until explicitly promoted.

## Verification Expectations

- Add only the minimum valuable tests for workflow validation, output references,
  state transitions, storage behavior, lifecycle safety, CLI protocol contracts,
  and security boundaries.
- Add focused driver contract tests using a fake JSONL process before relying on
  a local Pi installation.
- Keep live Pi integration tests optional and skipped when Pi or credentials are
  unavailable.
- Do not use coverage targets or test counts as quality goals.
- Before declaring work complete, run `pnpm run format:check`, `pnpm run lint`,
  `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`.
- Do not build, package, install, or smoke-test the Linux bundle unless the owner
  explicitly requests it.

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
