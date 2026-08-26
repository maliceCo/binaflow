# Architecture-First Refactor TODO

## Purpose

Refactor Binaflow toward the boundaries defined in `AGENTS.md`. The architecture
is the source of truth. Tests must protect product contracts, persistence, and
security boundaries; they must not preserve internal APIs, temporary structure,
visual copy, or an architecture being removed.

This document is an execution checklist. Complete phases in order. Do not start
a later phase while an earlier phase has unresolved acceptance criteria.

## Scope And Constraints

- Preserve protocol-v1 JSON and JSONL envelopes, field names, ordering, stream
  separation, and exit-code behavior unless this document explicitly calls out
  a bug fix required to preserve the documented contract.
- Preserve SQLite compatibility with existing runs through additive migrations.
- Never silently rerun a completed step. A completed step remains reusable only
  when its result and artifact references were transactionally persisted.
- Keep `plan-build` sequential. Keep `research-plan-build` experimental and
  workflow-specific. Do not add generic loops, DAGs, approvals, plugins,
  drivers, background services, detached execution, or parallelism.
- Do not add compatibility wrappers for removed internal APIs. Update all real
  callers in the same change instead.
- Do not change unrelated formatting, copy, dependencies, release packaging, or
  Linux bundle behavior.
- Do not add tests for implementation details, line coverage, static copy, or
  internal functions with no product consumer.
- Do not run or smoke-test the Linux bundle.

## Required Baseline For Every Phase

Before editing a phase:

1. Run `git status --short --branch`.
2. Read the target modules and their tests completely.
3. Identify unrelated worktree changes. Do not revert or alter them.
4. State the exact product contracts affected by the phase.

After editing a phase:

1. Run focused tests for changed contracts.
2. Run `pnpm.cmd run format:check`.
3. Run `pnpm.cmd run lint`.
4. Run `pnpm.cmd run typecheck`.
5. Inspect `git diff --check` and `git diff`.

Before declaring the complete program done:

1. Run `pnpm.cmd run format:check`.
2. Run `pnpm.cmd run lint`.
3. Run `pnpm.cmd run typecheck`.
4. Run `pnpm.cmd run test`.
5. Run `pnpm.cmd run build`.

## Phase 0: Record The Target Architecture

### Goal

Write the intended dependency boundaries before moving code. This is a design
checkpoint, not an implementation phase.

### Target Boundaries

- `src/core` contains serializable workflow/run contracts, the sequential
  runtime, state transitions, references, and consumer-owned narrow ports.
  It must not import config loading, concrete storage, concrete artifacts,
  concrete workflows, drivers, CLI, TUI, filesystem, or Pi.
- `src/application` composes core ports and owns use cases. It may coordinate
  the experimental research workflow without adding its concepts to the generic
  sequential engine.
- `src/storage`, `src/artifacts`, `src/drivers`, and `src/process` are adapters.
  They implement ports consumed by core or application.
- `src/cli` and `src/tui` are presentation adapters. They consume only
  application operations and presentation helpers. They do not access SQLite,
  artifact files, Pi, workflow catalogs, or workspace filesystem directly.
- Configuration parsing/loading is outside core. Pure profile types required by
  core move to a core/domain module, while filesystem config loading remains in
  `src/config.ts` or an application-owned adapter.
- `research-plan-build` owns approval, feedback, iteration reset, and its
  specialized persistence checkpoint. The generic sequential engine does not
  know approval IDs, loop state, research feedback, or `build-plan` literals.

### Deliverable

Add a short architecture note only if the target cannot be represented clearly
by module boundaries and tests. Do not create a new framework, dependency
injection container, or plugin mechanism.

### Acceptance Criteria

- The executor can state the allowed imports for every layer in one sentence.
- Every currently reported architecture issue is assigned to one later phase.
- No production code changes occur in this phase.

## Phase 1: Remove Tests That Freeze The Old Design

### Goal

Reduce test surface before architectural work. Remove tests and production APIs
that exist only to support obsolete test harnesses. Do not change product
behavior in this phase.

### Delete

- Delete `runInkFoundation`, `FoundationApp`, and
  `test/tui-ink-foundation.test.ts` if repository search confirms they have no
  production caller.
- Delete `appendLiveActivity` from `src/tui/execution.ts` and remove or rewrite
  its test in `test/tui-ink-execution.test.ts` if repository search confirms it
  has no production caller.
- Delete `RunStore.replaceArtifact` and its SQLite implementation if repository
  search confirms it has no production caller.
- Delete `test/cli.test.ts` help-copy assertions. Keep the incomplete `run`
  usage-error behavior only if no subprocess/protocol test already protects it.

### Merge Or Rewrite

- Move valuable cases from `test/application-phase8.test.ts` into tests named
  for their contracts: recovery explanation, artifact reading, clarification,
  and approval previews. Delete the `phase8` file.
- Move valuable cases from `test/tui-ink-phase6.test.ts` into the smallest
  existing reducer, lifecycle, or shell test that owns the behavior. Delete the
  `phase6` file.
- Keep one exact presenter/protocol contract and remove duplicate human-output
  permutations from `test/cli-output.test.ts`, `test/cli-protocol.test.ts`, and
  `test/application-run-view.test.ts`.
- Replace Ink helpers that search accumulated terminal history with a helper
  that asserts a frame emitted after the triggering action. Do not preserve
  navigation-only tests unless they guard an effect such as execution,
  configuration write, approval, cancellation, or recovery.
- Rename tests/files containing `phaseN` names to behavior names.

### Do Not Delete

- `test/engine.test.ts`, `test/persistence.test.ts`, `test/migrations.test.ts`,
  `test/artifacts.test.ts`, `test/drivers/contract.test.ts`,
  `test/core-contracts.test.ts`, `test/cli-protocol.test.ts`, and
  `test/tui-lifecycle.test.ts` remain, though individual weak cases may be
  rewritten.
- Keep one optional live Pi E2E smoke test only. It must not be used to test
  deterministic crash, resume, signal, or concurrency behavior.

### Acceptance Criteria

- No production export remains whose only consumer is a test.
- No test file or describe block uses a phase number as its responsibility.
- No Ink assertion passes by finding text emitted before the action under test.
- No product behavior is intentionally changed.
- The reduced suite still covers the minimal contracts in Phase 2.

## Phase 2: Establish The Minimal Contract Suite

### Goal

Keep a small, architecture-independent safety net. Add only tests that protect
behavior needed during the refactor.

### Required Contracts

#### Workflow And Engine

- Valid workflow definitions serialize and deserialize without harness details.
- Malformed workflow input definitions, input properties, references, and output
  schemas fail before creating or claiming a run.
- A builder receives the original objective and validated plan artifact, not a
  planner transcript or normalized event text.
- Completed steps are not rerun during resume.
- A failed upstream step can leave downstream work skipped, then recovery can
  persist `skipped -> pending -> running` after its dependency succeeds.
- A run interrupted between steps can resume missing workflow steps.

#### Persistence

- `completeStep` rolls back both step state and artifact references if any
  artifact insert fails.
- Run status writes use compare-and-set.
- Execution ownership is tested with a real child process, not only two stores
  in one Node process.
- Migrations use fixtures representing each historical persisted schema that was
  released, and reject a future schema version.

#### Lifecycle And Protocol

- First cancellation requests graceful abort.
- Second cancellation waits for operation cleanup and context close before force
  signaling.
- Stream failure follows the same shutdown path as cancellation.
- A TUI cannot start or replace an execution while an operation is active.
- CLI JSONL has an exact started/event/terminal sequence with correlated run IDs
  and contiguous event sequence numbers.

#### Security

- Initial TUI diagnosis parses configuration but does not execute `piCommand`
  until the user confirms the workspace.
- The logical `planner` profile cannot receive write capability.
- Artifact path containment remains protected.

### Rules

- If a required scenario exposes a known bug, add it in the same change that
  fixes the bug. Do not change the expected result to match defective behavior.
- Use fakes for drivers and controlled child processes for OS/process behavior.
  Do not use arbitrary sleeps where a deferred promise or observable child state
  can make the test deterministic.
- Use SQLite and artifact adapters in integration tests only where atomicity,
  migrations, ownership, or adapter compatibility is the contract.

### Acceptance Criteria

- Every retained test maps to one listed contract or a concrete product boundary.
- No test asserts private object layout, helper invocation count, static copy,
  or an obsolete module path.
- There is at most one test harness per concern: fake driver, temporary
  workspace, fake terminal, and child-process helper.

## Phase 3: Fix Lifecycle, Recovery, And Security Defects

### Goal

Correct high-risk behavior before or while extracting architecture. Do not hide
these defects behind refactoring.

### Required Changes

- In `WorkflowRuntime.prepareStep`, persist the intermediate `pending` state for
  `skipped` before persisting `running`.
- Make recovery eligibility depend on the workflow definition, including missing
  step rows and a terminal-status-only recovery case. Use the same rule for the
  runtime, application operation, CLI, and TUI view.
- Make lifecycle operation ownership synchronous. `beginOperation` must reject
  a second active operation; replacing an owned context must not close it while
  an active operation uses it.
- Centralize CLI signal handling with operation completion and context cleanup.
  The second signal records force intent; it must not call `process.kill` before
  cleanup completes.
- Keep TUI OS signal handlers installed through shutdown. First signal requests
  cancellation; second records force intent; shutdown then forces after cleanup.
- Handle CLI output errors and backpressure as lifecycle failures. Do not allow
  an unhandled `EPIPE` to bypass cleanup.
- Split configuration diagnosis into passive validation and explicit active
  `piCommand` probing after workspace confirmation.
- Enforce planner read-only constraints at workflow/profile validation, not only
  in generated configuration.
- Fix artifact selection to use `artifactOffset` and `artifactSelected`.

### Acceptance Criteria

- Each change has a Phase 2 contract test.
- Cancellation, process failure, render/stream failure, and normal completion
  close resources in one ordered path.
- No completed step is silently rerun.
- No workspace-controlled command runs before explicit user confirmation.

## Phase 4: Refactor Core And Research Boundaries

### Goal

Restore the intended dependency direction without generalizing experimental
research behavior.

### Required Changes

- Move pure agent profile types and profile resolution needed by the engine out
  of filesystem-backed `src/config.ts`.
- Replace the broad `RunStore` dependency with consumer-owned narrow ports. Keep
  execution persistence separate from history/event queries and specialized
  research checkpointing.
- Remove research-only members from `WorkflowRuntime`, `RunStore`, and generic
  step state transitions where possible:
  - `resetLoopStep`
  - `writeResearchInputArtifact`
  - `checkpointResearchIteration`
  - approval-specific and `build-plan` knowledge
- Give `ResearchPlanBuildCoordinator` a narrow research-owned persistence port.
  Do not add a generic approval or loop abstraction.
- Ensure `core` imports only core/domain contracts and explicitly allowed ports.
  It must not import `config.ts`, storage modules, artifact modules, concrete
  workflow modules, Pi, CLI, or TUI.

### Compatibility Rules

- Keep persisted database data readable through additive migrations only.
- Do not silently reinterpret completed steps or artifact references.
- If a storage interface changes, update its SQLite adapter and all production
  consumers in the same change. Do not retain a broad deprecated interface only
  for tests.

### Acceptance Criteria

- The sequential core can execute a serializable workflow without importing any
  concrete workflow, config loader, or adapter module.
- Research behavior remains available exclusively through its coordinator.
- Existing persisted runs remain inspectable and resumable according to their
  documented status semantics.

## Phase 5: Refactor Application And Presentation Boundaries

### Goal

Make application composition cohesive and presentation passive.

### Required Changes

- Split `src/application/operations.ts` by cohesive use case: execution/recovery,
  run history, artifacts, and research approval. Keep `ApplicationService` as
  the facade.
- Keep application composition in `src/application/runtime.ts`. Pi discovery and
  concrete adapters must be constructed there, not inside use cases.
- Remove direct workflow catalog imports from CLI and TUI. Expose required
  workflow contracts/summaries through application DTOs.
- Move folder listing and configuration probing from `shell-controller.tsx` to
  an application operation. TUI receives bounded DTOs only.
- Split `shell-controller.tsx` into execution control, workspace/setup control,
  and screen routing only where each extraction has a concrete consumer.
- Do not create hooks, stores, reducers, or service classes merely to split
  files. Each extracted module must own a distinct lifecycle or use case.

### Acceptance Criteria

- CLI/TUI have no direct imports of SQLite, file artifacts, Pi, workflow catalog,
  core engine, or `node:fs`/`node:path`.
- Application use cases do not instantiate concrete Pi adapters internally.
- No single extracted module has mixed execution ownership and workspace setup
  responsibility.

## Phase 6: Harden Storage And Updater Boundaries

### Goal

Remove remaining corruption, concurrency, and path-trust risks.

### Required Changes

- Serialize migrations by acquiring the SQLite write lock before reading and
  applying schema version state.
- Close SQLite if constructor initialization or migration fails.
- Treat `ESRCH` as a dead owner; do not treat permission errors as proof a process
  is dead. Decide and document a concrete lease/identity strategy for PID reuse.
- Limit or move large driver result bodies out of SQLite. Artifact content is the
  canonical large-output store; SQLite stores bounded metadata needed for views.
- Add cleanup for failed artifact temporary writes and preserve UTF-8 boundaries
  in bounded previews.
- Validate updater roots, `versions`, `current`, and `previous` canonically
  before recursive deletion, activation, or rollback.
- Improve updater locks so only `EEXIST` maps to contention and stale locks have
  a safe, documented recovery policy.
- Add explicit limits/timeouts for update download, extraction, hashing, and
  smoke testing. Do not alter release format unless an independently trusted
  release-signing decision is approved.

### Acceptance Criteria

- Concurrent first open/migration is deterministic.
- A stale or untrusted symlink cannot redirect update deletion or activation.
- Large output cannot grow unbounded in both memory and SQLite by default.

## Phase 7: Enforce Boundaries Automatically

### Goal

Prevent architectural regression after the refactor.

### Required Changes

- Replace regex-only checks in `test/architecture-boundaries.test.ts` with a
  TypeScript AST import analysis, or an ESLint rule with equivalent coverage.
- Check static imports, dynamic imports, reexports, and `require` if supported.
- Use explicit allowlists for core, application, CLI, and TUI imports.
- Keep the boundary test focused on module dependencies. Do not parse interface
  source text to enforce public API shape when TypeScript types can enforce it.

### Acceptance Criteria

- A prohibited static or dynamic import fails the boundary check.
- Tests do not pass merely because a forbidden import changed formatting.

## Final QA Handoff

Do this only after all phases are complete and the architecture is stable.

### Automated Verification

- Run all required final commands from the baseline section.
- Confirm no unintended files are modified.
- Confirm no removed test-only API remains exported.

### Manual QA Matrix

- New plan-build run: successful plan and build.
- Planner clarification: builder is skipped and no implementation runs.
- Failed builder: resume reuses completed planner output.
- Failed upstream: downstream skipped; after valid recovery, downstream runs.
- Interruption between steps: resume executes missing step only.
- Research ready: waiting approval, approve, then plan/build.
- Research rejected: feedback starts exactly one bounded new iteration.
- First and second cancellation in CLI and TUI: cleanup ordering and exit code.
- Closed JSONL consumer: no orphan process or active run without recovery path.
- Untrusted workspace: opening TUI does not execute configured command before
  confirmation.
- Existing database: inspect, history, artifacts, and resume compatibility.

### Explicitly Out Of Scope

- New workflow types.
- Generic DAG, loop, approval, retry orchestration, or plugin frameworks.
- New agent drivers or model providers.
- Remote workers, daemon, detached runs, worktrees, or scheduled execution.
- UI redesign unrelated to the boundary refactor.
- Linux bundle build or release validation.
