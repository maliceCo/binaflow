# Active Implementation Plan

## Scope

Build the smallest functional Binaflow MVP: a local TypeScript CLI that runs sequential agent workflows through Pi RPC. The original `plan -> build` workflow remains supported, and Phase 7 adds a bounded `research -> review -> approval -> plan -> build` workflow.

This plan intentionally excludes every item in `WISHLIST.md` unless the user explicitly changes this file. The user explicitly activated the concrete research workflow in Phase 7; native search and visualizer steps remain deferred.

## Target Workflow

```text
objective
  -> research profile (read-only, structured report)
  -> automatic review and human approval
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
- Initial workflow: sequential `plan-build`; Phase 7 workflow: bounded `research-plan-build`.
- Persistence: SQLite for run state and filesystem for artifacts.
- Workflow authoring: TypeScript that produces a versioned, serializable definition.
- Planner output: JSON validated against a schema; Pi uses prompted JSON plus local validation and repair.
- UI: CLI only.
- Implementation style: KISS; abstractions and architectural patterns require a concrete current use.
- Design principle: prioritize single responsibility for modules and functions without creating artificial fragmentation.
- Testing strategy: a minimal set of behavior-focused tests that document important flows and contracts; no coverage target or tests written only to exercise lines.
- Run semantics: a run is an immutable execution for one objective; clarification starts a new run rather than mutating or resuming the old objective.
- Step semantics: technical status is separate from functional disposition; `build` continues downstream work and `needs_clarification` stops it without being a technical failure.
- MVP guard: `plan-build` uses a fixed disposition guard; `research-plan-build` uses its explicit bounded review and approval gate.

## Non-Goals

- Do not add OpenCode, Codex, or any second driver.
- Do not add parallelism, DAG scheduling, maps, generic loops, generic conditions, or worktrees. Phase 7's bounded research loop and approval gate are the only concrete exceptions.
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

This hardening keeps the MVP sequential and adds no generic conditions, branching, or interactive clarification flow. Phase 7 adds one explicit bounded research loop and approval gate.

## Phase 6: End-To-End Verification

- [x] Run the opt-in temporary fixture for a safe `plan-build` E2E run.
- [ ] Configure a planner model and a lower-cost builder model through profiles.
- [x] Run a live execution when Pi credentials are available.
- [x] Verify planner read-only tool restrictions and builder write permissions.
- [x] Interrupt a run after planning and verify resume does not repeat planning.
- [x] Verify persisted plan artifact and step results through CLI inspection.
- [x] Verify persisted events and usage display.
- [x] Run formatter, linting, type checks, unit tests, and relevant integration tests.
- [x] Update this document with verified completion status and any blockers.

E2E implementation note:

- The live fixture is implemented in `test/e2e/plan-build.e2e.ts` and is excluded from the normal test suite.
- Run it explicitly with `BINAFLOW_E2E=1`, `BINAFLOW_E2E_PROVIDER`, and `BINAFLOW_E2E_PLANNER_MODEL`; the live fixture passed with Pi and `openai-codex`.
- E2E execution is registered as a WSL verification: run from Ubuntu-24.04 at `/mnt/d/projects/rts/binaflow`, against the shared Windows workspace.
- Re-verified live from WSL with the interactive `carlos` shell using `BINAFLOW_E2E=1`, `BINAFLOW_E2E_PROVIDER=openai-codex`, and `BINAFLOW_E2E_PLANNER_MODEL=gpt-5.6-luna`; `pnpm run test:e2e` completed with 2 passed in 75.97s.
- This verification used the planner model as the builder fallback because `BINAFLOW_E2E_BUILDER_MODEL` was not set; separate planner and builder model verification remains pending.

Acceptance criteria:

- A user can change profile model assignments without changing `plan-build`.
- Planner and builder use different model assignments in a real run.
- The MVP works with Pi and is structurally ready for a future second driver.
- No out-of-scope wishlist feature was introduced.

## Phase 7: Research-Plan-Build Workflow

This phase adds a concrete research workflow. Web search, MCP, plugins, and extensions remain
harness responsibilities; Binaflow consumes normalized results and validated artifacts. The
existing `plan-build` workflow remains supported.

### Decisions

- Workflow: `research -> automatic review -> human approval -> plan -> build`.
- Research may use repository and web tools configured by Pi or another future harness.
- A rejected approval sends feedback into a new research iteration in the same run.
- Automatic review may request more research without human intervention.
- Research is limited to three iterations per run.
- Research output, review output, and build plan are JSON-schema validated artifacts.
- Approval state and feedback are persisted and survive process restart.

### Implementation

- [x] Add `research-plan-build` to the workflow catalog and CLI commands.
- [x] Define and validate `ResearchReport` and `ResearchReview` schemas.
- [x] Add a persisted human approval gate with `approve` and `reject` CLI commands.
- [x] Implement bounded research re-iterations with feedback and resume support.
- [x] Keep harness tool selection external to Binaflow profiles and drivers.
- [x] Separate Pi project trust/configuration from read-only workspace permissions.
- [x] Verify first-pass approval, automatic re-research, human rejection, limit handling, and resume.

### Deferred Native Steps

Keep these in `WISHLIST.md` until a concrete workflow requires them:

- Native Binaflow web source providers.
- Deterministic code visualization artifacts.
- Visual planning artifacts consumed by an agent harness.

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

Phases 0 through 6 are complete and verified except for the separate planner/builder model assignment live check. Phase 7 is implemented and covered by focused workflow, persistence, contract, CLI, and configuration tests. Native Binaflow search and visualizer steps remain deferred.

### Preview Distribution

- [x] Prepare the package as `0.1.0-preview.0` for an npm preview release.
- [x] Add README installation, configuration, workflow, update, and limitation instructions.
- [x] Add an MIT license and restrict the published package to compiled `dist/src` files.
- [x] Verify the preview package with `pnpm pack --dry-run`.
- [ ] Publish the preview to npm with the `preview` dist-tag when the npm package name and publisher account are ready.

## Blockers And Decisions Log

- Pi 0.83.0 is available in the WSL environment; live E2E requires valid authentication for the selected provider.
- Testing must remain intentionally minimal and value-focused. Each test must protect meaningful behavior or document an important flow.
- Verification was executed in WSL because the Windows environment could not use its existing `node_modules` directory due to permissions.
- Pi selected Azure when the E2E provider was omitted; specifying `BINAFLOW_E2E_PROVIDER=openai-codex` matched the configured `gpt-5.6-luna` model and the live E2E passed.
- Harness-managed web tools, MCP, plugins, and extensions are intentionally outside Binaflow's active implementation scope.
- Native Binaflow search and visualizer steps remain deferred until a concrete workflow requires them.
- Phase 7 verification was run in WSL after rebuilding the local `better-sqlite3` binding for the WSL Node ABI; the Windows-installed binding targets a different ABI.
- A non-interactive WSL shell initially hid the user's nvm, pnpm, and Pi paths; the E2E skill's interactive `bash -ic` procedure loaded Node 22.23.2, pnpm 11.18.0, and Pi 0.83.0 successfully.
