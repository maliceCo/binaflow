# Active Implementation Plan

## Scope

Build the smallest functional Binaflow MVP: a local TypeScript CLI that runs a sequential `plan -> build` workflow through Pi RPC. The workflow is portable because it uses logical profiles; only configuration selects Pi and its models.

This plan intentionally excludes every item in `WISHLIST.md` unless the user explicitly changes this file.

## Target Workflow

```text
objective
  -> planner profile (read-only, structured plan)
  -> builder profile (workspace write, objective + validated plan)
  -> persisted run, steps, events, and artifacts
```

## Decisions Already Made

- Language and runtime: TypeScript on Node.js.
- Shape: modular monolith and one package.
- Package manager: `pnpm`.
- First harness: Pi through `pi --mode rpc`.
- Agent selection: external profiles, not workflow-embedded models.
- Initial workflow: sequential `plan-build` only.
- Persistence: SQLite for run state and filesystem for artifacts.
- Workflow authoring: TypeScript that produces a versioned, serializable definition.
- Planner output: JSON validated against a schema; Pi uses prompted JSON plus local validation and repair.
- UI: CLI only.
- Implementation style: KISS; abstractions and architectural patterns require a concrete current use.
- Design principle: prioritize single responsibility for modules and functions without creating artificial fragmentation.
- Testing strategy: a minimal set of behavior-focused tests that document important flows and contracts; no coverage target or tests written only to exercise lines.
- Run semantics: a run is an immutable execution for one objective; clarification starts a new run rather than mutating or resuming the old objective.
- Step semantics: technical status is separate from functional disposition; `build` continues downstream work and `needs_clarification` stops it without being a technical failure.
- MVP guard: `plan-build` uses a fixed disposition guard, not a generic condition or branching system.

## Non-Goals

- Do not add OpenCode, Codex, or any second driver.
- Do not add parallelism, DAG scheduling, maps, loops, conditions, approvals, or worktrees.
- Do not add RAG, memory, scraping, MCP integrations, voice, scheduled tasks, threat hunting, daemon mode, TUI, HTTP APIs, or distributed workers.
- Do not execute generated workflow code.
- Do not create a generic plugin system or use a dependency injection framework.

## Phase 0: Inspect And Bootstrap

- [x] Inspect the local Node.js, package-manager, and Pi installation versions.
- [x] Choose the smallest dependency set for CLI parsing, SQLite, schema validation, tests, linting, formatting, and TypeScript execution/build.
- [x] Create the single-package Node.js/TypeScript project structure.
- [x] Add scripts for formatting, linting, type checking, unit tests, and optional live integration tests.

Expected files:

```text
package.json
tsconfig.json
src/
test/
```

Acceptance criteria:

- The project installs cleanly.
- `format`, `lint`, `typecheck`, and `test` commands exist and run.
- The CLI entry point can print help.

## Phase 1: Define Core Contracts

- [x] Define the versioned serializable workflow model.
- [x] Define the initial `agent` step model with `id`, `profile`, `prompt`, `dependsOn`, and output references.
- [x] Define run, step-run, artifact, normalized event, and normalized result models.
- [x] Define `AgentDriver`, `RunStore`, `ArtifactStore`, and `EventSink` contracts.
- [x] Define external agent profile configuration for `planner` and `builder`.
- [x] Define the `BuildPlan` JSON Schema and TypeScript type.
- [x] Create the TypeScript `plan-build` workflow definition.

Expected files:

```text
src/core/workflow.ts
src/core/run.ts
src/core/agent.ts
src/core/events.ts
src/config.ts
src/workflows/plan-build.ts
```

Acceptance criteria:

- A workflow can be serialized and validated without starting an agent.
- `plan-build` contains no harness, provider, or model names.
- Profiles select the driver, model, tools, workspace mode, timeout, and retry limit.
- The planner output schema captures summary, tasks, verification, and risks.

## Phase 2: Add Local Persistence And Artifacts

- [x] Implement SQLite migrations and `SqliteRunStore`.
- [x] Persist workflow runs, step runs, attempts, status transitions, external session identifiers, outputs, errors, and usage when available.
- [x] Implement `FileArtifactStore` under a local Binaflow data directory.
- [x] Persist planner output as a named JSON artifact.
- [x] Implement transactional completion so a completed step has durable output and artifact references.
- [x] Implement loading of prior runs and reusable completed steps.

Expected files:

```text
src/storage/run-store.ts
src/storage/sqlite-run-store.ts
src/storage/migrations/
src/artifacts/artifact-store.ts
src/artifacts/file-artifact-store.ts
```

Acceptance criteria:

- A test can create a run, persist a step and artifact, then reload all of them.
- State transitions reject invalid changes.
- A completed step remains reusable after process restart.

## Phase 3: Implement The Sequential Engine

- [x] Load and validate a workflow definition and its input.
- [x] Resolve the sequential order from explicit dependencies.
- [x] Resolve output references from completed upstream steps.
- [x] Create and persist a step attempt before calling a driver.
- [x] Persist normalized events during execution.
- [x] Mark steps as completed, failed, cancelled, or interrupted.
- [x] Stop downstream execution when an upstream step fails.
- [x] Implement resume: reuse completed steps and retry only interrupted, pending, or explicitly retriable failed steps.
- [x] Add a narrow one-time repair path when the planner response fails schema validation.

Expected files:

```text
src/core/engine.ts
src/core/references.ts
src/core/state-machine.ts
```

Acceptance criteria:

- The engine runs `plan` before `build`.
- The builder receives the objective and the validated plan artifact, not the planner transcript.
- Resume does not rerun a completed planner step.
- A validated plan with a stopping disposition skips the builder and completes the run without invoking it.
- Engine tests cover success, planner failure, schema-repair failure, builder failure, and resume.
- Engine scenarios should be consolidated where that improves readability; do not multiply tests for equivalent implementation branches.

## Phase 4: Implement Process Transport And Pi Driver

- [x] Implement a generic child-process JSONL transport with robust line framing, request correlation, stderr capture, termination handling, and cancellation.
- [x] Implement `PiDriver` using `pi --mode rpc`.
- [x] Translate profile settings into Pi provider, model, thinking, session, and tool options.
- [x] Send prompts and consume Pi events until `agent_settled` or a terminal failure.
- [x] Normalize text output, session identifier, usage, cost, and errors.
- [x] Send Pi abort on cancellation or timeout, then terminate the process if needed.
- [x] Implement a fake JSONL executable or test harness for driver contract tests.
- [x] Add an optional live Pi integration test that skips without Pi and credentials.

Expected files:

```text
src/process/jsonl-process.ts
src/drivers/contract.ts
src/drivers/pi-rpc.ts
test/drivers/
```

Acceptance criteria:

- Driver tests do not require Pi or network access.
- The driver exposes only normalized events and results to the engine.
- A missing Pi executable or invalid profile produces a recorded actionable failure.
- Cancellation and timeout leave the step resumable rather than completed.

## Phase 5: Implement CLI And Operator Inspection

- [x] Implement `binaflow run plan-build --objective <text>`.
- [x] Implement `binaflow runs`.
- [x] Implement `binaflow show <run-id>`.
- [x] Implement `binaflow resume <run-id>`.
- [x] Render concise status with step ID, profile, driver, model, state, duration, and usage when available.
- [x] Make `show` display the planner artifact and builder result safely.
- [x] Return non-zero exit codes for failed and cancelled executions.

Expected files:

```text
src/cli/index.ts
src/cli/commands/run.ts
src/cli/commands/runs.ts
src/cli/commands/show.ts
src/cli/commands/resume.ts
```

Acceptance criteria:

- The CLI can start, inspect, and resume a persisted run.
- The user can see which profile, harness, and model each step used.
- The CLI remains usable without a TUI or daemon.

## Core Semantics Hardening

- [x] Add explicit planner decisions for buildable and clarification-required plans.
- [x] Persist step dispositions and skip reasons across process restarts.
- [x] Prevent downstream execution when a validated upstream step stops the workflow.
- [x] Show tool names and call IDs in verbose driver output.

This hardening keeps the MVP sequential and adds no generic conditions, branching, approvals, or interactive clarification flow.

## Phase 6: End-To-End Verification

- [x] Run the opt-in temporary fixture for a safe `plan-build` E2E run.
- [ ] Configure a planner model and a lower-cost builder model through profiles.
- [x] Run a live execution when Pi credentials are available.
- [x] Verify planner read-only tool restrictions and builder write permissions.
- [x] Interrupt a run after planning and verify resume does not repeat planning.
- [x] Verify persisted plan artifact and step results through CLI inspection.
- [ ] Verify persisted events and usage display.
- [x] Run formatter, linting, type checks, unit tests, and relevant integration tests.
- [x] Update this document with verified completion status and any blockers.

E2E implementation note:

- The live fixture is implemented in `test/e2e/plan-build.e2e.ts` and is excluded from the normal test suite.
- Run it explicitly with `BINAFLOW_E2E=1`, `BINAFLOW_E2E_PROVIDER`, and `BINAFLOW_E2E_PLANNER_MODEL`; the live fixture passed with Pi and `openai-codex`.

Acceptance criteria:

- A user can change profile model assignments without changing `plan-build`.
- Planner and builder use different model assignments in a real run.
- The MVP works with Pi and is structurally ready for a future second driver.
- No out-of-scope wishlist feature was introduced.

## Verification Commands

Finalize these commands during Phase 0 and keep this section current:

```text
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:integration
```

## Current Status

Phases 0 through 5 are complete and verified. Phase 6 has passing opt-in live E2E coverage for execution, permissions, artifacts, CLI inspection, and interruption/resume. Separate model assignments and complete event/usage inspection remain pending.

## Blockers And Decisions Log

- Pi 0.83.0 is available in the WSL environment; live E2E requires valid authentication for the selected provider.
- Testing must remain intentionally minimal and value-focused. Each test must protect meaningful behavior or document an important flow.
- Verification was executed in WSL because the Windows environment could not use its existing `node_modules` directory due to permissions.
- Pi selected Azure when the E2E provider was omitted; specifying `BINAFLOW_E2E_PROVIDER=openai-codex` matched the configured `gpt-5.6-luna` model and the live E2E passed.
