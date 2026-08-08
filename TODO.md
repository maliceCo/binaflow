# Architecture Remediation Execution Plan

This section is the authoritative execution contract for Terra or Luna. It
supersedes every unchecked task later in this file. The remaining content is
historical context and verification evidence only; do not implement an old
unchecked item unless this plan explicitly includes it.

Execute the phases in order without waiting for review between phases. Stop
only for an unresolved product decision, a destructive operation outside this
repository, or a blocker that cannot be resolved from the code and tests.

## Outcome

Leave Binaflow with:

- safe ownership of every attached execution;
- coherent state transitions and crash recovery;
- bounded live rendering, storage access, and process transport;
- an application boundary shared by CLI and TUI without exposing storage or
  engine internals;
- a sequential core free from presentation and concrete harness concerns;
- experimental research orchestration that remains explicit and specific;
- one supported Ink TUI and no legacy implementation;
- no `TODO.md` after all work and verification are complete.

## Non-Negotiable Constraints

- Preserve protocol-v1 JSON and JSONL envelopes, fields, ordering, stream
  separation, and exit-code behavior.
- Preserve persisted-run compatibility. Use additive migrations when storage
  changes are required.
- Keep execution attached. Do not add a daemon, detach, reconnect, scheduler,
  remote worker, second driver, parallel workflow execution, or generic plugin
  framework.
- Keep `research-plan-build` experimental. Do not introduce generic approval,
  loop, or DAG primitives.
- Prefer composition over inheritance. Do not add base classes for application,
  workflow, CLI, or TUI behavior.
- Do not add a dependency-injection framework, command bus, global TUI state
  library, or speculative ports with no current consumer.
- Keep CLI and TUI as presentation adapters. Neither may read SQLite, mutate
  engine state, or read artifact files directly.
- Keep Pi protocol details in the Pi driver and JSONL transport.
- Add the smallest behavior-focused regression scenario before each bug fix;
  one scenario may protect several related assertions.
- Do not weaken or delete a safety test merely to make the suite pass.
- Preserve unrelated working-tree changes. Inspect the diff before every edit.
- Finish every phase with its own QA review and one phase-specific commit.
- Never amend, force-push, or push. Publication remains an explicit owner
  action.
- Do not build, package, install, or smoke-test the Linux bundle unless the
  owner explicitly requests it. Final bundle validation belongs to the owner.

## Test Value Rules

The test suite exists to protect functionality, not to maximize coverage. Do
not add or configure a coverage target.

A test is valuable only when it protects at least one current contract:

- user-visible behavior or a complete application flow;
- persisted data integrity, state transitions, or crash recovery;
- cancellation, process, signal, stream, or terminal lifecycle safety;
- CLI JSON/JSONL compatibility, exit codes, or stdout/stderr separation;
- security boundaries such as path containment or terminal sanitization;
- a simple deterministic bound needed for functionality, such as one active
  refresh, bounded retained activity, or bounded parser input;
- a previously reproduced regression that could plausibly return.

Apply these rules to every test change:

- Prefer one readable behavior scenario over separate tests for equivalent
  permutations or individual lines.
- Test through the narrowest stable public boundary that proves the contract.
  Add a subprocess or full TUI journey only when the process/terminal boundary
  itself is the behavior under test.
- Do not test private helpers, internal call order, exact ANSI chunks, exact
  React component trees, implementation-specific strings, trivial accessors,
  TypeScript types, or library behavior.
- Do not duplicate the same assertion at engine, application, CLI, and TUI
  levels unless each level protects a different observable boundary.
- Avoid broad snapshots. Assert the small semantic output that consumers rely
  on.
- Do not add benchmark suites, load tests, smoke tests, or wall-clock
  assertions. Prove required bounds with a small deterministic input and direct
  observable assertions.
- Prefer real SQLite/filesystem adapters when transaction, migration, locking,
  or path behavior is the contract. Prefer small in-memory fakes for pure
  application orchestration.
- Fakes must implement the narrow interface consumed by the subject. Do not use
  `as unknown as` to disguise incomplete `RunStore`, `ArtifactStore`, engine, or
  application objects. Stream fixture casts are acceptable only at the Node/Ink
  boundary when the fake intentionally implements the exercised stream subset.
- Use `satisfies` for fixtures and protocol documents so excess or missing
  fields fail type checking without widening literal types.
- Every new test must state what regression it prevents. If that answer is only
  "coverage" or "this method exists", do not add the test.
- When a new test supersedes an equivalent legacy or lower-value test, remove
  the old test in the same verified phase.
- Keep live Pi tests opt-in. Driver behavior must remain reproducible with the
  fake JSONL process without credentials or model requests.

The phase test lists below describe required contracts, not required test
counts. Combine related bullets into the minimum number of coherent scenarios.

## TypeScript Quality Rules

- Keep `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes` enabled. Fix errors instead of weakening compiler
  options.
- Do not introduce `any`, `@ts-ignore`, unchecked double casts, or non-null
  assertions to bypass a design problem. Narrow `unknown` at external JSON,
  process, filesystem, and error boundaries.
- Prefer discriminated unions for workflow, run, screen, and operation states so
  invalid combinations are not representable. Use exhaustive `never` checks
  when every variant must be handled.
- Model required and optional data accurately. Do not use optional properties to
  avoid constructing valid state.
- Prefer narrow consumer-owned interfaces and `Pick`-style capabilities over
  passing broad contexts. Name a capability interface when it has more than one
  consumer; do not create one for a single trivial call.
- Prefer plain functions and composition. Use classes only for resources with
  identity or lifecycle, such as SQLite and child processes. Use inheritance
  only for idiomatic `Error` subclasses.
- Use `import type` for type-only dependencies and avoid barrel files that hide
  dependency direction or create cycles.
- Keep serialized workflow, profile, protocol, and persisted DTOs free of
  methods, class instances, `Map`, `Set`, `Date`, functions, and implicit
  `undefined` values.
- Preserve readonly inputs where mutation is not part of the contract. Copy at
  ownership boundaries rather than defensively cloning throughout the code.
- Handle promises explicitly. Do not leave floating work unless it is
  intentionally detached from control flow, cannot outlive its owner, and has a
  documented error path. Attached workflow work may never be fire-and-forget.
- Catch values as `unknown`, retain useful typed error codes, and do not parse
  behavior from human error messages.
- Avoid boolean option accumulation when named operations or a discriminated
  request make valid combinations clearer. Do not refactor a stable one-flag API
  without a concrete need.
- Avoid generic helpers, conditional types, overloads, and type-level machinery
  when a direct concrete type expresses the current use.
- Let TypeScript infer local implementation details, but annotate exported
  contracts, persistence/protocol boundaries, and callbacks where ownership or
  lifecycle would otherwise be ambiguous.

## Phase Protocol

For every phase:

1. Read the affected production code and existing tests completely.
2. Record any changed assumption in this section before implementation.
3. Add the minimum failing regression scenario needed to reproduce the
   observable defect; combine related behavior when the setup and contract are
   the same.
4. Implement the smallest cohesive correction.
5. Run focused functional tests, `pnpm run format:check`, `pnpm run lint`,
   `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`. Do not run bundle
   or installation checks.
6. Perform the phase QA review defined below.
7. Fix every real QA finding and rerun affected verification.
8. Mark tasks complete only after verification and record any environmental
   failure separately from product failures.
9. Inspect `git status`, the complete phase diff, `git diff --check`, and recent
   commits. Stage only intended phase files and create one non-interactive commit
   with a concise phase-specific message.
10. Start the next phase only after the QA remediation and commit succeed.

Only one phase may be in progress at a time. Do not combine architecture work
from a later phase with a correctness fix from the active phase.

## Mandatory QA For Every Phase

Each phase is incomplete until Terra or Luna performs and records its own QA:

- Verify every changed production line traces to an active phase task.
- Verify every new or retained test protects functional behavior, data,
  lifecycle, protocol, or security rather than coverage or implementation
  details.
- Verify no equivalent behavior is tested redundantly at multiple layers.
- Verify TypeScript strictness was not bypassed with `any`, double casts,
  `@ts-ignore`, unjustified non-null assertions, or broad partial fakes.
- Verify SRP, dependency direction, composition over inheritance, cleanup
  ownership, error paths, and persisted compatibility.
- Verify async work is awaited or explicitly owned and cannot outlive its
  resource owner.
- Verify hot paths remain bounded by inspection and a small deterministic
  functional scenario; do not create a benchmark or smoke test.
- Verify unrelated worktree changes remain untouched.
- Record findings in the active phase, remediate them, rerun affected checks,
  then create exactly one commit for that phase.

## Phase 0: Establish The Baseline

- [x] Inspect `git status`, the complete worktree diff, and recent commits;
      preserve all current unrelated edits.
- [x] Inventory existing tests by the contract they protect: product, data,
      lifecycle, protocol, or security.
- [x] Identify duplicate, implementation-detail, legacy-only, and coverage-only
      tests. Record candidates for Phase 8; do not delete safety or compatibility
      coverage before its Ink/application replacement passes.
- [x] Inventory unsafe test casts. Replace broad `as unknown as` fakes when the
      corresponding application/store boundary is narrowed; do not perform a
      standalone cast-cleanup rewrite.
- [x] Run the current focused Ink, application, engine, persistence, driver,
      CLI, and protocol tests without changing expectations.
- [x] Run the complete static and test verification suite.
- [x] Record current failures as product or environmental failures.
- [x] Confirm explicit CLI commands still lazy-load no React, Ink, SQLite, Ajv,
      Pi, or workflow execution graph unless the command needs it.

### Exit Criteria

- [x] The starting behavior and failures are reproducible and documented.
- [x] Every retained test category has a stated functional purpose; raw test
      count and line coverage are not acceptance criteria.
- [x] No production code changed in this phase.
- [x] Phase 0 QA is complete. The only finding is the recorded stale legacy
      assertion; it is retained until Phase 8 replaces it with Ink parity
      coverage. The baseline has its own commit.

### Current Test Audit Evidence

- On 2026-08-07, `pnpm run test` completed with 187 passed, 3 failed, and 1
  skipped test in 126.71 seconds.
- The three failures are in legacy TUI tests: one stale setup status assertion,
  one refresh-coalescing timeout, and one resize-render assertion. Equivalent
  Ink suites pass, so Phase 0 must classify whether each legacy test protects a
  still-current contract before Phase 8 removes or replaces it.
- The test tree contains 58 `as unknown as` occurrences. Most represent broad
  infrastructure fakes; stream fixture casts at the Node/Ink boundary are a
  separate intentional case. Narrow them only while implementing the final
  application interfaces.
- On 2026-08-07, Phase 0 reran the complete suite: 189 tests passed, 1 was
  skipped, and one legacy TUI test failed. The failure in
  `test/tui-phase6.test.ts` expects the stale message
  `Configuration written; readiness requires attention.` after configuration
  setup; the renderer instead reports the current `Configuration is ready.`
  state. The equivalent Ink setup suite passed, so retain this legacy test only
  until Phase 8 removes it after parity coverage is confirmed.
- Static verification (`format:check`, `lint`, `typecheck`, and `build`) passed.
  The 28 test files protect core workflow/data contracts; persistence and
  migrations; Pi transport and CLI protocol boundaries; configuration and
  application operations; and Ink/legacy TUI product and lifecycle behavior.
  Legacy `test/tui*.test.ts` files are Phase 8 removal candidates only after
  their Ink replacements protect the same contracts.
- Explicit CLI commands lazy-load Ink/React from `src/cli/index.ts`; the TUI
  shell is imported only for `tui` or an interactive no-argument invocation.
  Execution-only SQLite, Pi, and artifact dependencies remain behind dynamic
  imports in command handlers. Workflow catalog metadata is intentionally
  loaded to render help and workflow choices.

## Phase 1: Own Attached Execution Safely

### Tests First

- [x] Cover SIGINT and SIGTERM while opening context and before
      `onRunStarted`.
- [x] Cover input/output stream failure during an active workflow.
- [x] Cover first graceful cancellation and second forced cancellation.
- [x] Assert event unsubscription and active-operation settlement happen before
      an owned application context closes.
- [x] Assert Ink restores the terminal before injected force signalling.
- [x] Assert exit codes `130` and `143` remain correct.
- [x] Assert no workflow or Pi child continues after `runInkShell` resolves or
      rejects.

### Implementation

- [x] Introduce one compositional lifecycle owner for the active controller,
      active operation promise, event subscription, context ownership, and
      terminal exit. Do not put this policy in a base class.
- [x] Route user cancellation, OS signals, stream failures, render failures,
      and normal completion through the same ordered shutdown path.
- [x] Make the first request abort gracefully; make the second request await
      cleanup before force signalling.
- [x] Handle the startup window before a run ID or live screen exists.
- [x] Ensure unmount cleanup never closes SQLite while execution or event
      persistence is active.

### Exit Criteria

- [x] Ink owns every attached run from startup through every terminal path.
- [x] No detach path or cleanup race remains.
- [x] Phase 1 QA, remediation, focused verification, static verification, and
      commit are complete. Full-suite verification remains blocked only by the
      two pre-existing legacy CLI/TUI failures recorded in the Phase 0 baseline;
      no Phase 1 failure was observed.

### Verification Evidence

- On 2026-08-07, focused Ink foundation and shell lifecycle tests passed: 17
  tests across `test/tui-ink-foundation.test.ts` and `test/tui-ink-shell.test.ts`.
  They cover startup SIGINT/SIGTERM, active input/output stream failures,
  graceful and forced cancellation, terminal restoration before injected force
  signalling, exit codes, operation settlement, event unsubscription, and
  owned-context close ordering.
- On 2026-08-07, `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`,
  and `pnpm run build` passed. The full suite reached 193 passed, 1 skipped,
  and the same two pre-existing failures: the stale legacy setup assertion and
  the intermittent CLI incremental-input timeout. Focused Phase 1 verification
  passed independently.

## Phase 2: Make Claims And Recovery Safe

### Tests First

- [x] Verify incompatible resume rejects without changing run status, steps,
      approvals, artifacts, or timestamps.
- [x] Verify incompatible approval rejects before persisting its decision.
- [x] Using independent application/store instances, verify a live run cannot
      be marked interrupted or resumed by a second process.
- [x] Verify a genuinely abandoned run can still be recovered explicitly.
- [x] Verify concurrent run transitions cannot overwrite a newer state.

### Implementation

- [x] Check workflow ID, workflow version, persisted input, profile validity,
      retry eligibility, and approval preconditions before claiming a run.
- [x] Keep engine-side validation as defense in depth.
- [x] Replace optional `claimRun` and `claimApproval` fallbacks with the required
      transactional store contract.
- [x] Add the smallest local execution-ownership mechanism that can distinguish
      a live owner from an abandoned attached run. Keep it local and do not turn
      it into a lease service or daemon.
- [x] Allow `markRunInterrupted` only after proving that no live execution owns
      the run.
- [x] Make run status writes compare-and-set against the expected previous
      status and reject stale writers.

### Exit Criteria

- [x] Validation failures are non-mutating.
- [x] At most one local process can execute or recover a run at a time.
- [x] Phase 2 QA, remediation, focused verification, static verification, and
      commit are complete. Full-suite verification remains blocked only by the
      recorded legacy TUI and CLI test failures; no Phase 2-focused failure was
      observed.

### Verification Evidence

- On 2026-08-08, focused Phase 2 tests passed: 46 tests across application
  operations, persistence, migrations, and engine suites. They cover
  non-mutating resume and approval preflights, retry/profile validation,
  transactional claims, live-owner rejection, explicit abandoned recovery, and
  compare-and-set status transitions.
- On 2026-08-08, `pnpm run format:check`, `pnpm run lint`,
  `pnpm run typecheck`, and `pnpm run build` passed.
- On 2026-08-08, the full suite reached 198 passed, 1 skipped, and 3 failures.
  The failures are the pre-existing stale legacy TUI setup assertion and the
  intermittent legacy TUI refresh-coalescing and CLI incremental-input timeouts;
  no Phase 2-focused test failed.

## Phase 3: Repair Step And Research Checkpoints

### Tests First

- [x] Fail a step, resume successfully, and verify the completed retry contains
      no stale error, result, disposition, skip reason, or terminal timestamp.
- [x] Verify retry attempt history records the actual retry start time.
- [x] Verify non-retryable failures in research, review, plan, and build are not
      silently rerun.
- [x] Inject failure at every research-loop checkpoint boundary and verify a
      resumed run never combines new research with an old review.
- [x] Verify rejection feedback and approval attempt state survive interruption.
- [x] Verify permanent and transient `AgentDriverError` codes and retryability
      remain distinguishable in persisted state.

### Implementation

- [x] Construct pending/running retry state explicitly instead of spreading a
      terminal `StepRun` into a new attempt.
- [x] Apply the same retry eligibility policy to normal and experimental
      workflow paths.
- [x] Add one research-specific transactional checkpoint operation that updates
      the input artifact reference, research step, review step, and approval
      state atomically.
- [x] Preserve driver error codes and combine driver retryability with the
      configured retry budget.
- [x] Keep completed step state and artifact references transactional.

### Exit Criteria

- [x] Every persisted step state is internally consistent.
- [x] Crash recovery cannot pair artifacts from different research iterations.
- [x] Phase 3 QA, remediation, focused/full verification, and commit are
      complete.

### Verification Evidence

- On 2026-08-08, focused Phase 3 verification passed 41 tests across engine,
  research workflow, persistence, and migrations. The scenarios cover clean
  retry state, actual attempt start timestamps, shared retry eligibility,
  permanent/transient driver error metadata, non-retryable research/review/plan/
  build failures, rejection feedback and approval attempt recovery, and the
  transactional research checkpoint rollback/commit boundary.
- `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` passed.
- The full suite completed with 208 passed, 1 skipped, and 1 pre-existing
  failure. `test/tui-phase6.test.ts` still expects the stale
  `Configuration written; readiness requires attention.` message; the current
  renderer reports `Configuration is ready.`, and the equivalent Ink setup test
  passes. No Phase 3 test failed.
- No migration was required: the existing `step_attempts` schema already stores
  the required attempt history, and the checkpoint uses an additive RunStore
  operation over existing tables.

## Phase 4: Fix Ink Correctness And Performance

### Functional Tests First

- [x] Feed a small burst of text and status events and verify UI updates are
      coalesced, at most one inspection is active, and retained activity stays
      within its configured bounds.
- [x] Verify at most one persisted snapshot inspection is in flight and late
      snapshots cannot regress displayed state.
- [x] Verify launch, resume, and approval continuation update step state, usage,
      and cost consistently.
- [x] Verify a context opened for history cannot execute after configuration
      changes; execution must use exactly the profile values just reviewed.
- [x] Verify history detail and completion metadata do not load complete agent
      result text.
- [x] Verify approval shows the configured message, bounded research/review
      previews, and workspace-modification warning before actions.
- [x] Verify terminal controls are sanitized in objectives, IDs, profile/model
      names, errors, artifact content, and persisted metadata.
- [x] Verify hidden actions cannot run below minimum terminal size.
- [x] Verify selection remains visible and long detail/artifact content can
      reach its final line.

### Implementation

- [x] Buffer bounded live activity outside React render state and publish UI
      snapshots at a measured bounded interval.
- [x] Refresh persisted step summaries on status/error events or a coalesced
      timer, never once per text event.
- [x] Share one launch/continuation event path so resume cannot omit snapshots.
- [x] Track retained activity bytes incrementally instead of rescanning and
      copying the full bounded history for every event.
- [x] Recreate the owned application runtime after final configuration review,
      or provide an application operation that validates and opens the exact
      execution snapshot atomically.
- [x] Add a narrow inspection projection for completion metadata if existing
      compact inspection is insufficient.
- [x] Use the existing bounded research approval preview operation.
- [x] Centralize safe dynamic text rendering so raw dynamic `<Text>` calls do
      not depend on caller discipline.
- [x] Give each scrollable list or text area explicit selection and offset
      state; block all hidden actions while below minimum size.

### Exit Criteria

- [x] Live updates have bounded retained activity and at most one persisted
      inspection in flight under a small deterministic event burst.
- [x] Setup, launch, completion, history, recovery, artifacts, and approval are
      safe at supported terminal sizes.
- [x] Phase 4 QA, remediation, focused verification, static verification, and
      commit are complete. Full-suite verification remains blocked only by
      recorded pre-existing legacy TUI failures.

### Verification Evidence

- On 2026-08-08, focused Phase 4 verification passed 62 tests across
  `test/tui-ink-execution.test.ts`, `test/tui-ink-viewport.test.ts`,
  `test/tui-ink-text.test.ts`, `test/tui-ink-shell.test.ts`,
  `test/tui-ink-foundation.test.ts`, `test/tui-ink-phase6.test.ts`,
  `test/application-operations.test.ts`, and `test/persistence.test.ts`.
  Scenarios cover coalesced UI publish, single in-flight snapshot inspection
  with generation tokens, incremental activity byte bounds, usage-only step
  projection, history/completion without full agent text, approval previews and
  workspace warning, SafeText sanitization, minimum-size quit-only input, and
  selection/offset reachability for long content.
- Launch and continuation share `attachLiveControllers` + `handleLiveEvent`.
  Execution opens via `lifecycle.replaceOwnedContext` after final review so
  history-opened contexts cannot silently execute stale config (injected test
  contexts are reused without close).
- `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` passed.
- Full suite: 213 passed, 1 skipped, 2 failed. Failures are pre-existing legacy
  TUI tests (`test/tui-phase6.test.ts` stale setup status assertion;
  `test/tui.test.ts` intermittent empty first render). No Phase 4 Ink or
  application test failed.
- Commit intentionally not created per owner instruction.

## Phase 5: Harden Workflow And Process Contracts

### Tests First

- [x] Reject duplicate input-reference names.
- [x] Reject step-output references that are not reachable through declared
      dependencies; preserve valid transitive references.
- [x] Prove a non-BuildPlan JSON output named `plan` is validated only by its
      declared contract.
- [x] Make a fake Pi acknowledge `prompt` and exit before `agent_settled`; verify
      immediate failure instead of waiting for profile timeout.
- [x] Feed an oversized unterminated JSONL record and verify bounded failure.
- [x] Use a small deterministic burst with a blocked event sink to verify queued
      work remains ordered and owned without relying on timing thresholds.

### Implementation

- [x] Strengthen serializable workflow validation without changing valid
      workflow versions unnecessarily.
- [x] Remove output-name dispatch from the generic engine. Represent the current
      plan disposition with the smallest explicit workflow-owned contract.
- [x] Expose process termination to the Pi driver and race it against
      `agent_settled`, cancellation, and timeout.
- [x] Add a maximum JSONL record size measured in UTF-8 bytes.
- [x] Add bounded transport backpressure only if the deterministic scenario
      reproduces queue growth; otherwise record that no change was justified.
- [x] Avoid compiling the same structured-output schema for every attempt when
      a workflow-owned compiled validator already exists.

### Exit Criteria

- [x] Workflow behavior follows declared dependencies and contracts, not array
      order or artifact names.
- [x] Malformed or terminated child processes fail promptly with bounded memory.
- [x] Phase 5 QA, remediation, focused verification, static verification, and
      commit are complete.

### Verification Evidence

- On 2026-08-08, focused Phase 5 verification passed 35 tests across
  `test/core-contracts.test.ts`, `test/drivers/contract.test.ts`, and
  `test/engine.test.ts`.
- Coverage includes duplicate input refs, unreachable vs transitive step-output
  refs, plain JSON `plan` without BuildPlan disposition, Pi prompt-then-exit
  before `agent_settled`, oversized unterminated JSONL records, and existing
  ordered blocked-sink ownership in the Pi driver contract test.
- No transport backpressure change was justified: the existing serialized event
  processing chain already keeps blocked sinks ordered and owned.
- `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` passed.

## Phase 6: Enforce Application And Presentation Boundaries

### Architecture Rules To Enforce

- [x] Core may depend on domain types and inward-facing ports, never CLI, TUI,
      concrete storage, filesystem artifacts, Pi, or concrete workflow modules.
- [x] Application composes use cases and workflow-specific coordination.
- [x] CLI and TUI depend on application operations and presentation helpers
      only.
- [x] Storage, filesystem artifacts, and Pi remain replaceable adapters behind
      narrow consumer-owned contracts.

### Implementation

- [x] Move the experimental research coordinator out of the generic sequential
      engine while reusing one shared step execution/retry implementation. Do
      not generalize approval or loops.
- [x] Replace the infrastructure-exposing `ApplicationContext` consumed by
      presentation with a narrow application service/facade containing current
      operations and event subscription.
- [x] Keep concrete store, artifact store, engine, configuration, and close
      ownership private to the application composition root.
- [x] Move human status labels and date/duration formatting out of `src/core`
      into shared presentation code.
- [x] Consolidate workflow definitions and discovery metadata into one source
      of truth if the current dual catalogs still require manual synchronization.
- [x] Add a small static boundary test or lint rule that rejects forbidden
      imports. Do not add a dependency-analysis framework.
- [x] Replace presentation/application test doubles that cast partial broad
      infrastructure objects with typed fakes for the final narrow contracts.
- [x] Split the Ink shell only along demonstrated responsibilities: application
      routing, attached execution lifecycle, setup/launch, and
      history/artifacts/approval. Do not create a generic component framework.

### Exit Criteria

- [x] Presentation cannot access stores, artifact files, drivers, or engine
      state even accidentally.
- [x] The sequential engine has no import of a concrete workflow.
- [x] No production behavior uses class inheritance beyond idiomatic `Error`
      subclasses.
- [x] Phase 6 QA, remediation, focused/full verification, and commit are
      complete.

### Verification Evidence

- On 2026-08-08, focused Phase 6 verification passed 97 tests across
  architecture boundaries, engine, research workflow, application operations,
  core contracts, CLI protocol, and Ink/legacy presentation suites that use the
  new `ApplicationService` facade.
- Sequential step execution lives in `WorkflowRuntime`; experimental research
  orchestration is `ResearchPlanBuildCoordinator` outside the sequential engine.
  Build-plan disposition interpretation is workflow-owned via
  `interpretWorkflowDisposition`.
- Presentation (CLI and Ink) opens only `ApplicationService` from
  `openApplicationContext` / `openApplicationStorage`. Store, artifact store,
  engine, and Pi remain private to the composition root.
- Human formatting moved to `src/presentation/format.ts`. Workflow catalog is a
  single registration list in `src/workflows/catalog.ts`.
- `test/architecture-boundaries.test.ts` rejects forbidden core and presentation
  imports and checks that `ApplicationService` does not expose infrastructure
  fields.
- Ink shell screen constants live in `src/tui-ink/screens.ts`; lifecycle,
  execution, launch, and components remain separate modules.
- `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` passed.
- Full suite remains blocked only by pre-existing legacy TUI failures
  (`test/tui-phase6.test.ts` stale setup status assertion expecting
  `Configuration written; readiness requires attention.`; intermittent legacy
  `test/tui.test.ts` empty first render / refresh coalescing). Equivalent Ink
  coverage passes. No Phase 6-focused failure was observed.

## Phase 7: Normalize CLI Contracts

- [x] Reject unsupported JSONL modes before loading configuration, opening
      SQLite, or reading artifacts.
- [x] Determine machine output mode through argument parsing that respects the
      `--` delimiter, not `process.argv.includes`.
- [x] Use the CLI usage-error contract and exit code `2` for invalid update
      options.
- [x] Consolidate only the repeated protocol record constructors whose shapes
      must remain synchronized across run, resume, approve, and reject.
- [x] Verify human progress remains on stderr, human final output on stdout, and
      machine stdout contains protocol records only.
- [x] Keep only focused subprocess tests where process exit, stdout/stderr, or
      protocol framing is the contract; do not test installation or bundle
      launchers in this phase.

### Exit Criteria

- [x] Invalid invocations are deterministic and side-effect free.
- [x] Protocol-v1 output is byte-for-byte compatible where ordering is part of
      the contract.
- [x] Phase 7 QA, remediation, focused/full verification, and commit are
      complete.

### Verification Evidence

- On 2026-08-08, focused Phase 7 verification passed across
  `test/cli-protocol.test.ts` and the Phase 7 scenarios in
  `test/cli-subprocess.test.ts`. Coverage includes early unsupported-JSONL
  rejection without opening config/SQLite, argv machine-mode parsing that stops
  at bare `--`, shared `run.started`/`event`/`run.finished` constructors, update
  usage errors with exit code `2`, human progress on stderr, and machine stdout
  containing protocol records only.
- `rejectUnsupportedJsonl` runs before `openStorageContext` /
  `diagnoseConfigurationFile` / installer work for show, runs, artifacts,
  artifact, doctor, workflows, and update.
- Top-level error handling and Commander help routing use
  `machineModeFromArgv` / `machineOutputRequestedFromArgv` instead of
  `process.argv.includes`.
- `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` passed.
- Full suite: 228 passed, 1 skipped, 2 failed. Failures are pre-existing legacy
  TUI tests (`test/tui-phase6.test.ts` stale setup status assertion;
  `test/tui.test.ts` intermittent empty first render). No Phase 7 CLI test
  failed.

## Phase 8: Remove Legacy And Unused Code

- [ ] Complete the Ink parity matrix with a passing product or lifecycle test
      for every retained behavior.
- [ ] Remove duplicate and implementation-detail tests identified in Phase 0
      after confirming a smaller retained scenario protects each real contract.
- [ ] Verify the functional contracts for both public TUI entry points, non-TTY
      help, normal exit, errors, signals, cancellation, recovery, and approval
      without bundle or installation smoke tests.
- [ ] Delete `src/tui/app.ts`, `src/tui/render.ts`,
      `src/tui/terminal-session.ts`, legacy-only runners, and legacy-only tests.
- [ ] Remove unused production APIs and components only after repository-wide
      search proves they have no consumer, including the unused Ink
      `Confirmation`, `RunStore.listRuns`, ignored artifact format options, and
      test-only application helpers.
- [ ] Remove retry/claim compatibility branches made impossible by the final
      required contracts.
- [ ] Consolidate `src/tui-ink` under `src/tui` only if the move reduces the
      final public source layout without compatibility shims.
- [ ] Run `git diff --check` and inspect every deleted symbol for a remaining
      import, test, documentation reference, or package output.

### Exit Criteria

- [ ] Ink is the sole TUI implementation and no production line exists only for
      the deleted renderer.
- [ ] Every remaining public and internal API has a current consumer or a
      documented compatibility requirement.
- [ ] Phase 8 QA, remediation, focused/full verification, and commit are
      complete.

## Phase 9: Final Verification And Self-Destruction

### Documentation

- [ ] Update `README.md` with only verified user-visible behavior.
- [ ] Update `AGENTS.md` with the final dependency rules, lifecycle ownership,
      and verification expectations that must survive this plan.
- [ ] Remove every `AGENTS.md` instruction requiring agents to read or update
      `TODO.md`.
- [ ] Ensure `README.md`, `AGENTS.md`, and `WISHLIST.md` do not refer to the
      deleted legacy TUI or claim generic approval/loop capabilities.

### Full Verification

- [ ] Run `pnpm run format:check`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run test`.
- [ ] Run `pnpm run build`.
- [ ] Do not run `build:bundle`, installation checks, pseudo-terminal smoke, or
      release validation unless the owner requests them explicitly.
- [ ] Inspect `git status`, `git diff --check`, the complete diff, and all
      remaining TODO references.
- [ ] Complete Phase 9 QA and remediate every finding before applying the
      destruction gate. The Phase 9 commit is created after deleting this file.

### Destruction Gate

Delete `TODO.md` only when every condition below is true:

- [ ] Every task in this authoritative plan is complete and verified.
- [ ] No unresolved product failure or blocker remains.
- [ ] Environmental skips are documented outside `TODO.md` where they will
      survive its deletion.
- [ ] Final architecture decisions and operating instructions are preserved in
      `AGENTS.md`; user behavior is preserved in `README.md`.
- [ ] `AGENTS.md` and repository scripts no longer require `TODO.md` to exist.
- [ ] `git grep -n "TODO.md" -- ':!TODO.md'` returns no obsolete dependency on
      this file.
- [ ] The complete final verification passes after documentation and legacy
      deletion.
- [ ] The owner has not requested bundle validation, or any explicitly requested
      bundle validation has been completed separately by the owner or on demand.

When the destruction gate passes, delete `TODO.md` as the final repository
edit, stage only the verified Phase 9 changes and this deletion, and create the
single Phase 9 commit. Do not replace the file with another planning file,
completion marker, archive, or compatibility stub.

---

# Historical Implementation Record

Everything below this heading is retained temporarily as migration history and
measurement evidence. It is not active scope. It will be deleted together with
this file after Phase 9 passes.

## Product Direction

Binaflow has two complementary interfaces:

- The TUI is the primary interface for human users.
- The CLI is the stable interface for scripts, plugins, and harness consumers.
- External consumers use the versioned JSON and JSONL CLI protocol.
- The TUI and CLI reuse the same application operations.
- The TUI never reads or modifies SQLite directly.
- The workflow engine invokes harnesses through `AgentDriver`.
- A plugin invoking Binaflow and Binaflow invoking a harness are separate
  integration directions.
- The first TUI is attached to the current process.
- Detached execution, background jobs, and reconnection are not included.
- `research-plan-build` is supported but remains visibly experimental.

## Product Decisions

- [x] Make the TUI the planned primary human interface.
- [x] Keep the CLI as the automation and plugin interface.
- [x] Launch the TUI for no-argument interactive invocations.
- [x] Show help for no-argument non-TTY invocations.
- [x] Keep `binaflow tui` as the explicit TUI command.
- [x] Allow `init` to create configuration only after confirmation.
- [x] Never overwrite configuration without explicit confirmation.
- [x] Keep provider credentials and authentication outside Binaflow.
- [x] Keep `research-plan-build` visible as experimental.
- [x] Keep execution attached to the terminal.
- [x] Exclude daemon, detached execution, reattachment, scheduling, parallel
      runs, remote workers, and new harness drivers from this milestone.

## Instructions For Implementation Models

Each phase must be completed in order.

- [ ] Read `AGENTS.md` completely before each implementation session.
- [ ] Read this file completely before each implementation session.
- [ ] Read `WISHLIST.md` for context only.
- [ ] Implement only the active phase.
- [ ] Inspect current code before changing it.
- [ ] Preserve unrelated user changes in the working tree.
- [ ] Keep the workflow engine independent from TUI code.
- [ ] Keep Pi-specific behavior inside the Pi driver.
- [ ] Keep workflow definitions independent from harnesses and models.
- [ ] Preserve JSON and JSONL envelopes, fields, ordering, and stream
      separation.
- [ ] Keep machine modes free from prompts, colors, spinners, and terminal
      control sequences.
- [ ] Load TUI dependencies only when the TUI is requested.
- [ ] Avoid speculative abstractions and broad refactors.
- [ ] Add only tests that protect meaningful behavior.
- [ ] Record blockers and deviations in this file immediately.
- [ ] Run focused verification before marking any item complete.
- [ ] Mark only verified items as completed.
- [ ] Prefer composition over inheritance. Do not introduce inheritance for TUI
      behavior, presentation, or state.
- [ ] Treat the TUI as a Binaflow consumer: use application operations, never
      SQLite, `RunStore`, `ArtifactStore`, or engine state transitions directly.
- [ ] Add a capability to Binaflow's application layer before using it in the
      TUI when another presentation layer could reasonably need it.
- [ ] Keep components, hooks, and application operations single-purpose. Do
      not add patterns, state libraries, frameworks, or abstractions without a
      demonstrated current need.
- [ ] Keep tests minimal and behavior-focused. Every test must protect a user,
      safety, lifecycle, or compatibility contract.
- [ ] For every active Phase 10 subphase: implement, verify, review the diff,
      implement and verify the review remediation, commit the phase, update
      this file, then continue immediately to the next subphase.
- [ ] Do not pause for external review between Phase 10 subphases. Stop only
      for an unresolved blocker, an explicit user direction, or after Phase
      10 is fully complete.

## Phase 0: Align Scope And Documentation

### Goal

Make the repository describe the product that is actually being built.

### Tasks

- [x] Update `AGENTS.md` to recognize the consumer TUI as active scope.
- [x] Keep daemon and detached execution explicitly out of scope.
- [x] Document the TUI as the human interface.
- [x] Document JSON and JSONL as the external automation and plugin interface.
- [x] Document `AgentDriver` as the Binaflow-to-harness interface.
- [x] Explain that a plugin invoking Binaflow is different from Binaflow
      invoking a future harness driver.
- [x] Keep OpenCode and Codex drivers in `WISHLIST.md`.
- [x] Document `research-plan-build` as experimental.
- [x] Keep generic approval and loop primitives in `WISHLIST.md`.
- [x] Move the TUI direction out of wishlist-only status.
- [x] Add the normal TUI user journey to `README.md`.
- [x] Add the CLI/plugin integration architecture to `README.md`.
- [x] Ensure `AGENTS.md`, `TODO.md`, `WISHLIST.md`, and `README.md` do not
      contradict each other.

### Verification

- [x] Search scope documents for contradictory TUI, approval, loop, and daemon
      statements.
- [x] Confirm no future-only feature was accidentally moved into active scope.
- [x] Run `pnpm run format:check` or the repository-equivalent direct command.

### Exit Criteria

Phase 0 is complete when product boundaries are explicit and consistent.

## Phase 1: Protect CLI And Protocol Contracts

### Goal

Establish a safe baseline before sharing behavior between the CLI and TUI.

### Tasks

- [x] Add subprocess tests for unknown commands, unknown options, missing
      arguments, and conflicting output modes.
- [x] Verify human invocation errors exit with code `2`.
- [x] Verify JSON invocation errors produce one valid protocol error document.
- [x] Verify JSONL invocation errors produce one valid protocol error record.
- [x] Fix Commander error interception only if tests reproduce incorrect
      behavior.
- [x] Reject interactive or TUI behavior when `--json` or `--jsonl` is active.
- [x] Ensure human progress remains on stderr and final results remain on
      stdout.
- [x] Ensure JSONL stdout contains only protocol records.
- [x] Emit `Started run` only after the run and input artifact are persisted.
- [x] Add a regression test proving a displayed run ID can immediately be
      inspected.
- [x] Preserve all existing protocol-v1 payload shapes.
- [x] Add focused protocol assertions for discovery, inspection, artifacts,
      run, and resume.

### Verification

- [x] Run focused CLI and protocol tests.
- [x] Run `pnpm run format:check` or the repository-equivalent direct command.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run build`.

### Exit Criteria

Phase 1 is complete when the CLI remains deterministic for humans and machine
consumers.

## Review Remediation

The following corrections were identified during the Phase 1 architecture and
code review. Complete them before starting Phase 2. Stop for external review
after each remediation group.

### R1: Output Contracts And Documentation

- [x] Send human `Started run` progress to stderr.
- [x] Send human `Resuming run` progress to stderr.
- [x] Reuse one human-progress presentation function for both commands.
- [x] Keep final human summaries on stdout.
- [x] Remove unavailable TUI commands from current README usage instructions.
- [x] Keep JSON and JSONL stdout free from human progress.

### R2: Functional Contract Tests

- [x] Verify the run-start callback sees the persisted run input artifact and
      its complete content.
- [x] Verify interactive execution preserves extra `--input-json` fields.
- [x] Verify human run progress/result stream separation at the subprocess
      boundary.
- [x] Verify ordered JSONL terminal records for `run` and `resume`.
- [x] Accept the documented `run.finished` and `run.failed` terminal forms.
- [x] Assert the complete artifact reference in the JSON contract test.
- [x] Add timeout and child cleanup to the CLI subprocess test helper.

### R3: Experimental Workflow Recovery

- [x] Persist automatic research feedback so resume can restore it.
- [x] Persist human rejection feedback so resume can restore it.
- [x] Test interruption after automatic research feedback.
- [x] Test interruption after human rejection feedback.
- [x] Keep approval and loops specific to `research-plan-build`.

### R4: Event And Cancellation Reliability

- [x] Serialize asynchronous Pi event normalization.
- [x] Propagate event-sink failures deterministically.
- [x] Check cancellation before spawning Pi.
- [x] Check cancellation between workflow steps.
- [x] Test event ordering and rejecting event sinks.
- [x] Test pre-aborted and between-step cancellation.

### R5: Historical Inspection Contracts

- [x] Persist resolved execution profile metadata for new runs.
- [x] Add compatible storage migration and legacy-run handling.
- [x] Define retention for superseded `run.input` files until a future artifact
      garbage-collection policy can remove unreferenced files safely.
- [x] Restrict or clearly mark approval metadata as experimental and
      workflow-specific.
- [x] Make default `show` avoid loading complete event and artifact bodies.

### Remediation Verification

- [x] Run focused remediation tests.
- [x] Run formatting, linting, type checking, tests, and build.
- [x] Record known environmental failures without changing unrelated tests.
- [x] Stop for external review before starting R3.

### R3 Verification

- [x] Run focused research, engine, persistence, and migration tests.
- [x] Run formatting, linting, type checking, tests, and build.
- [x] Confirm the existing two Windows symlink failures remain unrelated.
- [x] Stop for external review before starting R4.

### R4 Verification

- [x] Run focused driver, engine, and cancellation tests.
- [x] Run formatting, linting, type checking, tests, and build.
- [x] Confirm the existing two Windows symlink failures remain unrelated.
- [x] Stop for external review before starting R5.

### R5 Verification

- [x] Run focused metadata, migration, catalog, and inspection tests.
- [x] Run formatting, linting, type checking, tests, and build.
- [x] Confirm the existing two Windows symlink failures remain unrelated.
- [x] Stop for external review before starting Phase 2.

## Phase 2: Introduce Shared Application Operations

### Goal

Allow the CLI and TUI to reuse behavior without duplicating engine or storage
rules.

### Tasks

- [x] Extract only the operations required by both interfaces.
- [x] Extract a run-workflow operation from the current CLI handler.
- [x] Extract a resume-run operation from the current CLI handler.
- [x] Extract an inspect-run operation from the current CLI handler.
- [x] Extract approval and rejection operations from current CLI handlers.
- [x] Extract workflow discovery and configuration diagnosis operations.
- [x] Keep output formatting inside CLI or TUI presentation modules.
- [x] Keep SQLite access behind `RunStore`.
- [x] Keep artifact access behind `ArtifactStore`.
- [x] Keep state transitions inside the engine and store.
- [x] Keep signal and cancellation behavior explicit.
- [x] Avoid a dependency injection framework or generic command bus.
- [x] Update existing CLI commands to use the extracted operations.
- [x] Confirm explicit CLI behavior remains unchanged.

### Verification

- [x] Run CLI tests before and after extraction.
- [x] Run engine and persistence tests.
- [x] Compare representative human CLI output before and after extraction.
- [x] Compare representative JSON and JSONL output before and after extraction.
- [x] Run formatting, linting, type checking, tests, and build.

### Exit Criteria

Phase 2 is complete when CLI and TUI code can call the same operations without
importing each other.

## Phase 3: Improve Inspection And Local Performance

### Goal

Make run history and live events suitable for an interactive interface.

### Measurements

- [x] Measure CLI startup, config loading, SQLite opening, Pi startup, and
      command completion separately.
- [x] Measure event count and event bytes for representative runs.
- [x] Measure time spent persisting normalized events.
- [x] Measure database growth caused by streamed text events.
- [x] Measure `runs` and `show` with realistic history sizes.
- [x] Record measurements before selecting optimizations.
- [x] Compare the Linux bundle from native Linux storage before reconsidering
      the runtime language.

### Inspection Tasks

- [x] Add an operation that counts events without loading them.
- [x] Stop loading all events for default `show`.
- [x] Load complete events only when explicitly requested.
- [x] Make default `show` compact.
- [x] Stop reading every artifact body during default inspection.
- [x] Add explicit artifact-content or full-output behavior.
- [x] Add bounded run listing with a default limit.
- [x] Add status and workflow filters needed by the TUI.
- [x] Add cursor or stable pagination before histories become unbounded.
- [x] Add indexes only after confirming the query requires them.
- [x] Avoid parsing large JSON artifacts merely for previews.

### Runtime Tasks

- [x] Serialize asynchronous event handling so sink failures cannot become
      unhandled rejections.
- [x] Propagate event persistence failures deterministically to execution.
- [x] Preserve event ordering.
- [x] Measure before batching or coalescing text events.
- [x] If justified, batch persistence while flushing status and error events
      immediately.
- [x] Flush pending events before a step or run reaches a terminal state.
- [x] Check cancellation before spawning Pi.
- [x] Check cancellation between workflow steps.
- [x] Clear or unreference child-exit timeout timers.
- [x] Treat either child exit code or signal code as process termination.
- [x] Define whether profile timeout is per RPC phase or total step duration.
- [x] Add tests for slow and rejecting event sinks.

### Historical Accuracy

- [x] Stop presenting current profile configuration as historical execution
      metadata.
- [x] Persist resolved provider, model, tools, workspace mode, trust, timeout,
      and retry policy used by a step.
- [x] Use an additive and compatible migration.
- [x] Display persisted execution metadata in run inspection.
- [x] Label legacy runs when execution metadata is unavailable.

### Verification

- [x] Run persistence and migration tests.
- [x] Run focused high-event-volume tests.
- [x] Run cancellation and process lifecycle tests.
- [x] Verify default `show` remains bounded.
- [x] Verify filtered and paginated run listing.
- [x] Compare measurements with the baseline.
- [x] Run formatting, linting, type checking, tests, and build.

### Exit Criteria

Phase 3 is complete when history access is bounded, event failures are
deterministic, and optimizations are based on measurements.

## Phase 4: Add Configuration And Diagnosis Operations

### Goal

Let a new user reach a valid first run without manually constructing a config.

### Doctor Tasks

- [x] Add a configuration diagnosis operation.
- [x] Report workspace, configuration, and data-directory paths.
- [x] Validate every configured profile with field-specific messages.
- [x] Report required and missing profiles for each workflow.
- [x] Report provider, model, tools, workspace mode, trust, timeout, and retry.
- [x] Detect whether the configured Pi command can be launched.
- [x] Do not claim authentication or model availability without a reliable Pi
      probe.
- [x] Add `binaflow doctor`.
- [x] Add structured `binaflow --json doctor` output.
- [x] Ensure diagnosis does not create a run.

### Init Tasks

- [x] Add a configuration-generation operation.
- [x] Add `binaflow init`.
- [x] Refuse to overwrite an existing config by default.
- [x] Require explicit confirmation before writing.
- [x] Show the target path and complete proposed configuration.
- [x] Default planner profiles to read-only.
- [x] Explain builder write and shell permissions before enabling them.
- [x] Ask users to enter provider and model values manually.
- [x] Never request or store provider credentials.
- [x] Write configuration atomically.
- [x] Validate generated configuration before replacing the target.
- [x] Add tests for creation, cancellation, existing-file refusal, invalid
      input, and atomic failure.

### Verification

- [x] Run config and CLI tests.
- [x] Verify no config is written without confirmation.
- [x] Verify machine mode never prompts.
- [x] Verify diagnosis works without execution profiles where possible.
- [x] Run formatting, linting, type checking, tests, and build.

### Exit Criteria

Phase 4 is complete when a new user can configure and diagnose a workspace
safely.

## Phase 5: Select And Establish The TUI Foundation

### Goal

Introduce the smallest maintainable terminal UI foundation.

### Dependency Spike

- [x] Evaluate no more than two maintained Node.js TUI libraries.
- [x] Require Node.js 22 and TypeScript support.
- [x] Prefer a library without mandatory native addons.
- [x] Require keyboard input, resize handling, and alternate-screen cleanup.
- [ ] Add scrolling when a later screen introduces scrollable content.
- [x] Require a practical automated testing strategy.
- [x] Verify Linux x86_64 bundle compatibility.
- [x] Measure added startup time and bundle size.
- [x] Avoid React unless its benefits clearly outweigh added complexity.
- [x] Record the selected dependency and tradeoffs in `TODO.md`.

The dependency spike evaluated `terminal-kit` 3.1.4, which is actively
maintained and supports Node.js 16+, keyboard input, resize handling, and
alternate-screen control, but adds a large dependency tree and requires
separate community type definitions. `neo-blessed` 0.2.0 has the needed UI
primitives but its published maintenance is from 2022. The selected foundation
is a small Node.js standard-library TUI shell and renderer: it keeps TypeScript
and Node.js 22 support direct, adds no runtime dependency or native addon, has
no bundle-size impact beyond the application code, and can be tested with fake
input/output streams. A richer widget library can be reconsidered only when a
later screen needs it.

### Shell Tasks

- [x] Add a lazily imported `binaflow tui` command.
- [x] Launch the TUI for no-argument interactive invocations.
- [x] Show help for no-argument non-TTY invocations.
- [x] Preserve every explicit CLI command.
- [x] Enter and leave alternate-screen mode safely.
- [x] Restore the terminal after normal exit, errors, SIGINT, and SIGTERM.
- [x] Support terminal resize.
- [x] Support `NO_COLOR`.
- [x] Avoid ANSI output when color is disabled.
- [x] Use ASCII status symbols by default.
- [x] Add a minimum-terminal-size fallback.
- [x] Add a stable semantic color palette.
- [x] Keep the TUI dependency out of normal CLI startup.

### Initial Screens

- [x] Implement the application shell.
- [x] Implement the home screen.
- [x] Show workspace and readiness.
- [x] Show new workflow, attention-required runs, history, configuration, and
      diagnosis actions.
- [x] Implement consistent keyboard navigation.
- [x] Show key hints in one predictable location.
- [x] Provide an explicit exit action.

### Verification

- [x] Add focused TUI rendering and navigation tests.
- [x] Add tests for non-TTY behavior.
- [x] Add tests for terminal restoration.
- [x] Add tests for resize and minimum-size behavior.
- [x] Measure CLI startup to prove explicit commands did not regress.
- [x] Run formatting, linting, type checking, tests, build, and bundle build.

### Exit Criteria

Phase 5 is complete when the TUI shell is safe, portable within the supported
Linux target, and isolated from normal CLI startup.

## Review Remediation: Phases 3-5

- [x] Keep missing-profile failures terminal and persisted in the workflow
      engine.
- [x] Keep engine and research event-sink failures from leaving runs `running`.
- [x] Make profile snapshot and run-history migrations transactional and
      recoverable after an interrupted profile-column migration.
- [x] Handle JSONL child stdin errors through the transport failure path.
- [x] Reject write-capable tools in shared read-only profile validation.
- [x] Diagnose malformed `piCommand` values without spawning Pi.
- [x] Reap timed-out Pi diagnosis processes.
- [x] Publish generated config files atomically without replacing a concurrent
      writer.
- [x] Pause stdin and restore TUI terminal state after normal exit, errors, and
      signals.
- [x] Preserve SIGINT/SIGTERM exit codes and handle split key sequences.
- [x] Serialize TUI refresh operations and ignore results after shutdown.
- [ ] Add a scrollable viewport when a future TUI screen needs it.

## Review Remediation: Phases 3-5 Static Review

- [x] Prevent concurrent resume and approval execution with transactional run
      claims.
- [x] Make approval decision persistence and the waiting-run claim atomic.
- [x] Persist failed terminal state when `onRunStarted` presentation callbacks
      reject.
- [x] Preserve completed steps and artifacts when post-commit event emission
      fails.
- [x] Bound text-event buffering by count and UTF-8 byte size.
- [x] Share buffered event persistence semantics between CLI and application
      runtime observers.
- [x] Convert JSONL message and stderr listener failures into transport errors.
- [x] Restrict readiness to stable workflows and require a successful Pi probe.
- [x] Consume non-TTY init input incrementally.
- [x] Protect profile maps and own-property profile lookup from reserved keys.
- [x] Attribute machine-mode errors from parsed command context, not option
      values.
- [x] Distinguish an unperformed Pi probe from an unavailable command.
- [x] Preserve raw Ctrl-C as SIGINT with exit code `130`.
- [x] Restore the terminal before default force-cancel signalling.
- [x] Abort and await active TUI work before closing owned application context.
- [x] Suppress hidden actions below the minimum terminal size.
- [x] Sanitize dynamic foundation-renderer text.
- [x] Extract terminal-session ownership from the large TUI application module;
      current lifecycle behavior remains covered in the TUI tests.

### Verification

- [x] Add regression tests for claims, approval races, start callbacks,
      post-commit event failures, bounded buffering, config readiness/probes,
      CLI attribution, raw Ctrl-C, active TUI termination, and terminal safety.
- [x] Run formatting, linting, type checking, tests, build, and `git diff --check`.
- [x] Full remediation verification passed 149 of 151 tests. The same two update
      tests remain blocked by Windows symlink `EPERM` at `test/update.test.ts`.

## Phase 6: Implement Setup And Workflow Launch

### Goal

Provide the complete first-run and new-workflow journey.

### Setup Flow

- [x] Detect missing configuration from the home screen.
- [x] Offer setup, documentation, or exit.
- [x] Reuse Phase 4 diagnosis and configuration-generation operations.
- [x] Guide planner configuration.
- [x] Guide builder configuration.
- [x] Explain read-only and read-write access in plain language.
- [x] Display the complete target configuration before writing.
- [x] Require confirmation.
- [x] Return to the home screen with updated readiness.

### Workflow Selection

- [x] Load workflows from the workflow catalog.
- [x] Show stable workflows separately from experimental workflows.
- [x] Show description, steps, required profiles, and outputs.
- [x] Mark `research-plan-build` as Experimental.
- [x] Do not describe approval or loops as generic engine capabilities.
- [x] Disable or explain workflows with missing profiles.

### Input And Confirmation

- [x] Prompt for required string inputs from the workflow contract.
- [x] Preserve optional structured inputs.
- [x] Validate input before confirmation.
- [x] Show the objective clearly.
- [x] Show every profile involved.
- [x] Show provider, model, workspace mode, tools, and trust.
- [x] Highlight steps that can modify files or execute commands.
- [x] Require explicit confirmation before write-capable workflows.
- [x] Allow editing the objective before starting.
- [x] Allow cancellation without creating a run.

### Verification

- [x] Test first-run setup.
- [x] Test existing configuration.
- [x] Test missing profiles.
- [x] Test invalid input and correction.
- [x] Test cancellation before run creation.
- [x] Test write-permission confirmation.
- [x] Test experimental workflow labeling.
- [x] Run formatting, linting, type checking, tests, and build.

### Exit Criteria

Phase 6 is complete when a new user can safely configure and start a workflow
without manually entering CLI commands.

## Phase 7: Implement Live Execution And Completion

### Goal

Present workflow execution clearly without overwhelming the terminal.

### Live Screen

- [x] Show run ID, workflow, status, elapsed time, tokens, and cost.
- [x] Show all workflow steps and current states.
- [x] Show active agent messages.
- [x] Show tool starts and completions compactly.
- [x] Show errors prominently.
- [x] Allow summary and detailed activity views.
- [x] Throttle screen redraws independently from event persistence.
- [x] Preserve events when rendering is throttled.
- [x] Sanitize terminal control sequences from agent output.
- [x] Bound in-memory displayed log history.
- [x] Keep full persisted history accessible through inspection.

### Cancellation

- [x] Make first cancellation request graceful.
- [x] Explain what is being cancelled.
- [x] Confirm leaving during an active run.
- [x] Do not offer detach or background execution.
- [x] Restore the terminal after cancellation.
- [x] Preserve exit code `130` for CLI cancellation.
- [x] Ensure interrupted runs remain inspectable and policy-compliant.

### Completion

- [x] Distinguish completed, failed, waiting, cancelled, and interrupted.
- [x] Show duration, tokens, and cost.
- [x] Show completed and skipped steps.
- [x] Show final semantic artifacts.
- [x] Offer plan, builder result, changes, and return-home actions.
- [x] Keep artifact UUIDs secondary to semantic names.

### Verification

- [x] Test completion, failure, graceful cancellation, and forced cancellation.
- [x] Test terminal restoration after errors.
- [x] Test large event streams and bounded UI memory.
- [x] Test escape-sequence sanitization.
- [x] Test resize during execution.
- [x] Run focused driver and engine lifecycle tests.
- [x] Run formatting, linting, type checking, tests, and build.

### Exit Criteria

Phase 7 is complete when users can understand and control an attached run from
start to terminal state.

## Phase 8: Implement History, Recovery, Artifacts, And Approval

### Goal

Let users recover work and inspect results without copying IDs.

### History And Recovery

- [x] Show recent runs with status, workflow, objective, and relative time.
- [x] Show attention-required runs separately.
- [x] Support status and workflow filters.
- [x] Use bounded pagination.
- [x] Open a run from the list.
- [x] Show persisted historical execution metadata.
- [x] Avoid loading full event or artifact content for the list.
- [x] Offer resume only for states supported by the engine.
- [x] Explain which completed steps will be reused.
- [x] Never silently rerun completed steps.
- [x] Explain workflow-version incompatibility.
- [x] Explain why cancelled runs cannot be resumed.
- [x] Present clarification questions from planner-only runs.
- [x] Offer a new run with a revised objective instead of pretending same-run
      clarification exists.

### Artifacts

- [x] List artifacts using semantic names such as `plan.plan` and `build.result`.
- [x] Distinguish input, intermediate, and final artifacts.
- [x] Load artifact content only when selected.
- [x] Support text and formatted JSON.
- [x] Bound previews and offer explicit full viewing.
- [x] Handle missing or corrupt artifacts without crashing the run view.

### Experimental Approval

- [x] Show the configured approval message.
- [x] Show research and review artifacts before approval.
- [x] Explain that approval can lead to workspace modifications.
- [x] Offer approve, reject with feedback, or leave waiting.
- [x] Require non-empty rejection feedback.
- [x] Display submitted rejection feedback.
- [x] Reuse the existing approval operation.
- [x] Avoid introducing a generic approval engine abstraction.
- [x] Preserve JSON and JSONL approval behavior without prompts.

### Verification

- [x] Test history filtering and pagination.
- [x] Test completed-run inspection.
- [x] Test retryable failure and resume.
- [x] Test interrupted run recovery.
- [x] Test workflow-version incompatibility.
- [x] Test missing artifacts.
- [x] Test approval, rejection, feedback, and waiting.
- [x] Confirm completed research steps are not silently repeated.
- [x] Run formatting, linting, type checking, tests, and build.

### Exit Criteria

Phase 8 is complete when all persisted states have a clear and safe user
action.

## Review Remediation: Phases 6-8

- [x] Revalidate configuration readiness and permissions immediately before
      launching a workflow.
- [x] Decode split UTF-8 input and split terminal escape sequences safely.
- [x] Keep TUI signal, cancellation, active-operation, and terminal cleanup
      behavior explicit and bounded.
- [x] Bound displayed live activity and expose recent errors without loading
      unbounded output into the terminal.
- [x] Use persisted completion timestamps and semantic artifact actions in the
      completion view.
- [x] Sanitize C1 control characters in dynamic TUI text.
- [x] Bound clarification reads and validate artifact paths through realpath
      checks.
- [x] Preserve completed steps and artifacts while recovering interrupted work.
- [x] Add status-list filtering for attention views and keep pagination bounded.
- [x] Expose persisted `running` runs in attention history.
- [x] Require explicit `YES` confirmation before marking a persisted `running`
      run interrupted for recovery.

### Verification

- [x] Focused Phase 6-8 remediation verification passed 12 application/TUI
      tests, including explicit persisted-running recovery confirmation.
- [x] Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, and
      `git diff --check` passed.
- [x] Full verification passed 162 tests with 2 skipped tests. The same two
      update tests remain blocked by Windows symlink `EPERM` at
      `test/update.test.ts`.
- [x] Direct repository binaries were used because `corepack pnpm` cannot
      resolve the nested pnpm executable in this Windows environment.

## Phase 9: Product Polish And Release Verification

### Usability

- [x] Use consistent status language across TUI and CLI.
- [x] Use human-readable durations and timestamps.
- [x] Keep detailed IDs available but visually secondary.
- [x] Ensure errors state what failed, why it matters, and the next action.
- [x] Ensure every empty state has one useful next action.
- [x] Verify narrow, normal, and wide terminal layouts.
- [x] Verify keyboard-only operation.
- [x] Verify `NO_COLOR`.
- [ ] Verify behavior over SSH and tmux where available.
- [x] Ensure experimental functionality is labeled everywhere.

### Documentation

- [x] Document the normal TUI journey.
- [x] Document the non-interactive CLI journey.
- [x] Document JSON and JSONL plugin consumption.
- [x] Document the distinction between CLI consumers and `AgentDriver`.
- [x] Document attached execution and lack of reconnection.
- [x] Document configuration safety and permission prompts.
- [x] Document recovery of interrupted and failed runs.
- [x] Update preview limitations.

### Performance

- [x] Re-run startup measurements.
- [x] Compare CLI startup against the pre-TUI baseline.
- [x] Compare bundle startup from native Linux and mounted WSL storage.
- [x] Compare event persistence throughput.
- [x] Compare large-history inspection.
- [x] Record measured regressions and accepted tradeoffs.
- [x] Do not propose a Rust rewrite without new evidence.

### Full Verification

- [x] Run repository-equivalent `format:check`.
- [x] Run repository-equivalent `lint`.
- [x] Run repository-equivalent `typecheck`.
- [x] Run repository-equivalent tests.
- [x] Run repository-equivalent `build`.
- [x] Run the Linux bundle build script directly from verified WSL Node.
- [x] Run focused protocol checks against the built CLI.
- [x] Run the TUI from the built Linux bundle under a pseudo-terminal.
- [ ] Run optional live Pi E2E validation when available.
- [x] Record environmental failures separately from product failures.
- [x] Confirm no existing JSON or JSONL consumer contract changed.
- [x] Confirm explicit CLI commands work without loading the TUI.
- [x] Confirm no daemon, parallel execution, or new harness driver was added.

### Exit Criteria

The consumer TUI milestone is complete when a new user can configure a
workspace, start a workflow, understand progress, inspect results, recover a
failed run, and handle experimental approval without memorizing CLI commands.

## Phase 10: Replace The Attached TUI With Ink

### Goal

Replace the handwritten terminal renderer with a fresh Ink implementation that
is easier to maintain, supports deliberate responsive layouts and scrolling,
and preserves all Binaflow safety and CLI contracts. This is a presentation
replacement, not a workflow-engine, storage, or protocol rewrite.

### Architecture Decision

- Ink and React are justified for the TUI only: the current renderer clears the
  terminal on every interaction, has manual layout logic, and clips long
  content rather than supporting a viewport.
- The new TUI lives temporarily in `src/tui-ink/`. It is built as a fresh
  composition of small screen components and narrowly scoped hooks; do not
  copy the legacy `src/tui` controller or renderers into React.
- The TUI is a consumer of Binaflow application operations. It must never read
  SQLite or call `RunStore`, `ArtifactStore`, or engine state transitions.
- A new reusable Binaflow capability belongs in `src/application` first, with
  focused operation tests, before a TUI component consumes it. Presentation-
  only state remains in Ink.
- The legacy TUI remains the production route until the formal parity gate. The
  two implementations must never run in one process or share terminal input,
  signal, raw-mode, cursor, or alternate-screen ownership.
- Keep `runTui(options): Promise<void>` and the CLI's lazy dynamic-import
  boundary. Explicit CLI commands must not load React, Ink, or Yoga.
- Ink is the official attached human interface. Future independent TUIs consume
  Binaflow through the versioned CLI JSON/JSONL protocol, not internal TUI
  modules. There is still no daemon, detach, reconnection, or reattachment.
- This `TODO.md` is the temporary execution contract for this migration. After
  Phase 10.8 is verified and committed, delete it as directed by the product
  owner; preserve final user-facing behavior in `README.md` and repository
  instructions in `AGENTS.md` before deletion.

### Phase 10 Execution Protocol

For every subphase below, complete this sequence without waiting for external
review:

1. Implement only the listed scope and run its focused verification.
2. Review the complete phase diff against this architecture, existing product
   contracts, single responsibility, composition, security, lifecycle safety,
   and unnecessary complexity. Require every changed line to have a concrete
   purpose.
3. Record review findings in this file. Create and execute the smallest
   remediation plan for every real finding, then rerun affected verification.
4. Run the phase-wide verification, update only verified checkboxes and notes,
   inspect `git status`, `git diff --check`, and the full phase diff, then make
   one non-interactive commit with a concise phase-specific message.
5. Start the next subphase immediately. Stop only for an unresolved blocker or
   an explicit user decision.

Do not create a public implementation selector, a permanent legacy fallback,
a global state library, a generic component framework, generic approval/loop
primitives, or unrelated application refactors.

### Phase 10.0: Freeze Parity And Baseline

#### Tasks

- [x] Add a parity matrix that maps each meaningful legacy TUI test and README
      promise to an Ink replacement test and a migration subphase.
- [x] Classify old assertions as product, safety/lifecycle, or handwritten
      implementation detail. Only the first two require behavioral parity.
- [x] Record the explicit decision that Ink supersedes the earlier no-React TUI
      decision because responsive layout and scrollable content are now a
      concrete requirement.
- [x] Record the current focused TUI tests, full verification result, explicit
      CLI startup timing, and Linux bundle size as the baseline.
- [x] Confirm the current public TUI entry points remain legacy during all
      pre-cutover subphases.

#### Parity Matrix

The matrix distinguishes behavior that users or process safety depend on from
assertions about the handwritten implementation. Ink tests will use semantic
screen behavior and injected streams rather than reproducing legacy parser,
renderer, or output-chunk details.

| Legacy source and scenario                                                                | Class            | Ink replacement                       | Phase |
| ----------------------------------------------------------------------------------------- | ---------------- | ------------------------------------- | ----- |
| `test/tui.test.ts`: home screen and wrapped navigation                                    | Product          | `home.navigation`                     | 10.2  |
| `test/tui.test.ts`: keyboard navigation and minimum-size fallback                         | Product          | `foundation.input-minimum-size`       | 10.1  |
| `test/tui.test.ts`: split escape sequences and UTF-8 prompt input                         | Safety/lifecycle | `foundation.input-decoding`           | 10.1  |
| `test/tui.test.ts`: raw Ctrl-C distinct from `q`                                          | Safety/lifecycle | `foundation.interrupt-input`          | 10.1  |
| `test/tui.test.ts`: idle Ctrl-C exit code 130                                             | Safety/lifecycle | `foundation.sigint-exit`              | 10.1  |
| `test/tui.test.ts`: actions blocked below minimum size                                    | Product          | `shell.minimum-size-input`            | 10.2  |
| `test/tui.test.ts`: dynamic path and error sanitization                                   | Safety/lifecycle | `shell.dynamic-text-safety`           | 10.2  |
| `test/tui.test.ts`: `NO_COLOR` and alternate-screen lifecycle                             | Safety/lifecycle | `foundation.no-color-terminal`        | 10.1  |
| `test/tui.test.ts`: normal exit, SIGINT, and SIGTERM restoration                          | Safety/lifecycle | `foundation.terminal-restoration`     | 10.1  |
| `test/tui.test.ts`: input and output stream errors restore terminal                       | Safety/lifecycle | `foundation.stream-error-cleanup`     | 10.1  |
| `test/tui.test.ts`: refresh result discarded after shutdown                               | Safety/lifecycle | `shell.stale-refresh`                 | 10.2  |
| `test/tui.test.ts`: diagnosis refresh requests are coalesced                              | Product          | `shell.refresh-coalescing`            | 10.2  |
| `test/tui.test.ts`: setup failure cleanup and non-TTY refusal                             | Safety/lifecycle | `foundation.tty-refusal-cleanup`      | 10.1  |
| `test/tui.test.ts`: resize redraw                                                         | Product          | `shell.resize-layout`                 | 10.2  |
| `test/tui-phase6.test.ts`: first-run setup writes after confirmation                      | Product          | `setup.confirmed-write`               | 10.3  |
| `test/tui-phase6.test.ts`: existing configuration is not overwritten                      | Safety/lifecycle | `setup.existing-config-safety`        | 10.3  |
| `test/tui-phase6.test.ts`: experimental workflows and missing profiles                    | Product          | `setup.workflow-availability`         | 10.3  |
| `test/tui-phase6.test.ts`: invalid input correction and cancel before run                 | Safety/lifecycle | `setup.input-correction-cancel`       | 10.3  |
| `test/tui-phase6.test.ts`: write permissions require confirmation                         | Safety/lifecycle | `setup.write-permission-confirmation` | 10.3  |
| `test/tui-phase6.test.ts`: changed profile requires renewed confirmation                  | Safety/lifecycle | `setup.profile-review-invalidation`   | 10.3  |
| `test/tui-phase6.test.ts`: quitting attached execution does not detach work               | Safety/lifecycle | `execution.quit-active-run`           | 10.4  |
| `test/tui-phase7.test.ts`: completion and failure details with usage/artifacts            | Product          | `execution.completion-summary`        | 10.4  |
| `test/tui-phase7.test.ts`: live status, steps, tools, and sanitized messages              | Product          | `execution.live-activity`             | 10.4  |
| `test/tui-phase7.test.ts`: first cancellation is graceful and attached                    | Safety/lifecycle | `execution.graceful-cancel`           | 10.4  |
| `test/tui-phase7.test.ts`: second cancellation is forceful and restores terminal          | Safety/lifecycle | `execution.forced-cancel`             | 10.4  |
| `test/tui-phase7.test.ts`: second OS signal during startup force-cancels                  | Safety/lifecycle | `execution.signal-escalation`         | 10.4  |
| `test/tui-phase7.test.ts`: active work settles before owned context closes                | Safety/lifecycle | `execution.context-shutdown-order`    | 10.4  |
| `test/tui-phase7.test.ts`: cleanup occurs before default force signal                     | Safety/lifecycle | `execution.force-signal-cleanup`      | 10.4  |
| `test/tui-phase7.test.ts`: displayed activity is bounded and resize works                 | Product          | `execution.activity-bounds-resize`    | 10.4  |
| `test/tui-phase8.test.ts`: attention runs, filters, relative time, pagination             | Product          | `history.filters-pagination`          | 10.5  |
| `test/tui-phase8.test.ts`: detail metadata, recovery, clarification, approval             | Product          | `history.detail-recovery-approval`    | 10.5  |
| `test/tui-phase8.test.ts`: bounded artifact text and corrupt JSON errors                  | Safety/lifecycle | `artifacts.bounded-read-errors`       | 10.5  |
| `test/tui-phase8.test.ts`: open history, filter, detail, and return                       | Product          | `history.open-return`                 | 10.5  |
| `test/tui-phase8.test.ts`: rejection feedback can cancel with `q` or Escape               | Safety/lifecycle | `approval.feedback-cancel`            | 10.5  |
| `test/tui-phase8.test.ts`: historical recovery stays attached and cancellable             | Safety/lifecycle | `history.attached-resume-cancel`      | 10.5  |
| `test/tui-phase8.test.ts`: persisted running run needs explicit interruption confirmation | Safety/lifecycle | `history.stale-running-confirmation`  | 10.5  |
| `test/phase9.test.ts`: 56, 80, and 120 column layout bounds                               | Product          | `shell.responsive-layouts`            | 10.2  |

README promises are covered separately because they describe the public
journey rather than one test implementation:

| README promise                                                                                                       | Class            | Ink replacement                  | Phase |
| -------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------- | ----- |
| No-argument TTY and `binaflow tui` open the attached interface                                                       | Product          | `entry.public-tui-routes`        | 10.7  |
| Setup, workflow selection, validation, permissions, launch, history, recovery, approval, and artifacts are available | Product          | `journey.complete-attached-flow` | 10.6  |
| `j`/`k`, arrows, Enter, and `q` are keyboard controls                                                                | Product          | `shell.keyboard-navigation`      | 10.2  |
| Ctrl-C cancels gracefully first and forcefully second                                                                | Safety/lifecycle | `execution.cancel-escalation`    | 10.4  |
| Non-TTY no-argument invocation shows help                                                                            | Safety/lifecycle | `entry.non-tty-help`             | 10.1  |
| TUI execution is attached and has no detach, daemon, background, or reconnect path                                   | Safety/lifecycle | `execution.no-detach-lifecycle`  | 10.4  |
| Recovery reuses completed steps and never silently reruns them                                                       | Safety/lifecycle | `history.safe-recovery`          | 10.5  |
| Waiting approval is specific to experimental `research-plan-build`                                                   | Product          | `approval.experimental-scope`    | 10.5  |
| Artifact previews are bounded and full reads remain explicit                                                         | Safety/lifecycle | `artifacts.preview-bounds`       | 10.5  |
| `NO_COLOR` removes SGR colors but preserves required terminal control                                                | Product          | `foundation.no-color-terminal`   | 10.1  |
| Explicit CLI commands remain the stable automation interface                                                         | Safety/lifecycle | `entry.cli-contracts`            | 10.6  |
| Explicit CLI commands do not load the TUI dependency graph                                                           | Safety/lifecycle | `entry.lazy-cli-loading`         | 10.1  |
| The current preview clips long content and has no scrollable viewport                                                | Product          | `shell.scrollable-viewports`     | 10.2  |

Assertions that only inspect `parseKeys` return values, exact renderer strings,
raw-mode call arrays, ANSI redraw chunks, or legacy module names are classified
as handwritten implementation details and will not be ported as behavior.

#### Phase 10.0 Baseline

- Decision: Ink and React supersede the earlier no-React foundation decision.
  Responsive layouts and a real scrollable viewport are now concrete product
  requirements; the dependency cost will be measured again in Phase 10.1.
- Public route status: both `binaflow tui` and no-argument TTY invocation still
  dynamically import only `src/tui/app.js`; no Ink dependency or production Ink
  launch path exists.
- Focused TUI baseline on 2026-08-05: 5 files, 37 tests passed from
  `test/tui.test.ts`, `test/tui-phase6.test.ts`, `test/tui-phase7.test.ts`,
  `test/tui-phase8.test.ts`, and `test/phase9.test.ts`.
- Full test baseline on 2026-08-05: 21 files, 164 tests passed, 2 skipped, and
  2 failed in `test/update.test.ts` because Windows denied test symlink creation
  with `EPERM`. The failures are environmental and unrelated to this phase.
- Static baseline on 2026-08-05: direct Prettier check, ESLint, TypeScript
  typecheck, TypeScript build, and `git diff --check` passed.
- Built CLI startup samples on Windows Node 22: `--help` took 57.1-80.5 ms and
  `--json workflows` took 164.4-201.1 ms across five warm samples.
- Linux x86_64 bundle baseline from the verified Phase 9 bundle: compressed
  archive 48,493,068 bytes; extracted payload 140,353,157 bytes. The bundle
  launched help and the attached legacy TUI under a pseudo-terminal.
- Baseline limitation: SSH/tmux validation is unavailable in this Windows
  session, and live Pi E2E remains optional because it consumes model requests.

#### Verification

- [x] Run all existing TUI and Phase 9 layout tests unchanged.
- [x] Run format, lint, typecheck, tests, build, and `git diff --check`.
- [x] Confirm `binaflow tui` and no-argument TTY invocation still load only
      `src/tui`.

#### Exit Criteria

- [x] Every current user-visible or safety-critical TUI behavior has a planned
      Ink test and phase.
- [x] No Ink dependency or production Ink launch path exists yet.

### Phase 10.1: Prove The Ink Foundation

#### Tasks

- [x] Add only the production dependencies required for Ink and React and the
      development types required for strict TypeScript.
- [x] Configure TypeScript TSX support without changing non-TUI module output.
- [x] Create a minimal `src/tui-ink/` bootstrap and an internal-only developer
      runner; do not add a public CLI command.
- [x] Prove TTY refusal, input, resize awareness, `NO_COLOR`, minimum-size
      fallback, normal unmount, error cleanup, SIGINT, and SIGTERM handling.
- [x] Give Ink exclusive ownership of rendering and input. Do not wrap it in
      the legacy terminal session or manual key parser.
- [x] Keep Binaflow responsible for attached-run cancellation policy, exit
      codes, active-operation cleanup, event unsubscription, and owned
      application-context closure.
- [x] Verify Node 22 ESM and Linux x86_64 bundle compatibility for React, Ink,
      and Yoga.

#### Verification

- [x] Add focused foundation tests using supported Ink test facilities or
      injected streams.
- [x] Run legacy TUI tests unchanged plus format, lint, typecheck, tests, build,
      and bundle build.
- [x] Run the Linux x86_64 bundle and internal Ink foundation under a
      pseudo-terminal.
- [x] Measure explicit CLI startup and bundle size against Phase 10.0.
- [x] Confirm normal CLI help and explicit commands do not load the Ink module
      graph.

#### Exit Criteria

- [x] The internal Ink shell starts and restores the terminal safely.
- [x] Dependency cost is measured and accepted in this file.
- [x] The production route remains legacy.

### Phase 10.2: Build The Ink Shell And Viewports

#### Tasks

- [x] Build small compositional components only for a screen frame, header,
      persistent key-hint footer, status/error display, selection list, text
      prompt, confirmation, and minimum-size fallback.
- [x] Implement home, documentation, diagnosis refresh, and exit with
      application operations and lazy application-context creation.
- [x] Implement independent list and text viewports with selection visibility,
      `j`/`k`, arrows, PageUp/PageDown, and previous/next content indicators.
- [x] Support 56, 80, and 120 column layouts without manually clearing the
      whole screen on every keypress.
- [x] Sanitize every dynamic text value before rendering.
- [x] Coalesce diagnosis refreshes and discard results after unmount.

#### Verification

- [x] Add tests for navigation, scrolling, footer visibility, resize,
      `NO_COLOR`, sanitization, refresh coalescing, and stale async results.
- [x] Confirm no Ink module imports storage or engine internals.
- [x] Run legacy tests and phase-wide static verification.

#### Exit Criteria

- [x] Long list and text content are scrollable with a stable footer.
- [x] The Ink shell has no generic state framework or copied legacy renderer.

### Phase 10.3: Setup And Workflow Launch

#### Tasks

- [x] Implement missing-config choices, planner/builder setup prompts,
      permission explanation, full configuration preview, explicit write
      confirmation, and existing-file refusal.
- [x] Implement workflow discovery, stable/experimental grouping, missing
      profile explanations, required and optional input collection, correction,
      objective editing, and profile/permission review.
- [x] Revalidate configuration and reviewed permissions immediately before
      launch using application operations.
- [x] Ensure cancellation before confirmation never creates a run.

#### Verification

- [x] Port all product and safety scenarios from `test/tui-phase6.test.ts` to
      Ink tests without reproducing raw-parser implementation details.
- [x] Verify configuration is never written without confirmation or overwritten
      by the TUI.
- [x] Verify changed profiles require a renewed confirmation.
- [x] Run legacy tests and phase-wide static verification.

#### Exit Criteria

- [x] Ink reaches safe launch confirmation with no direct config or storage
      access outside application operations.

### Phase 10.4: Attached Execution And Completion

#### Tasks

- [x] Implement attached launch and resume using application operations and
      normalized event subscriptions.
- [x] Show run ID, workflow, status, elapsed time, usage, cost, step states,
      agent activity, tool activity, errors, and summary/detail activity views.
- [x] Bound displayed activity by count and UTF-8 bytes, throttle rendering
      independently from persistence, and retain all persisted events.
- [x] Use structured state where available; do not carry forward brittle status
      inference from event-message text without an explicit compatibility need.
- [x] Implement completed, failed, cancelled, interrupted, and waiting
      completion views with semantic artifact actions.
- [ ] Preserve first graceful and second forced cancellation, terminal
      restoration before force signalling, exit codes 130/143, and waiting for
      active work before owned context cleanup.

#### Verification

- [ ] Port all product and lifecycle scenarios from `test/tui-phase7.test.ts`.
- [ ] Test startup cancellation, graceful and forced cancellation, signals,
      stream errors, large event streams, sanitization, resize, and cleanup.
- [ ] Run focused application-runtime and engine lifecycle tests plus phase-wide
      static verification.

#### Exit Criteria

- [ ] Ink safely owns an attached run from launch to every terminal state.
- [ ] No run continues after its TUI process exits and no detach path exists.

### Phase 10.5: History, Recovery, Artifacts, And Approval

#### Tasks

- [x] Implement bounded history, attention runs, status/workflow filters,
      pagination, and run detail through inspection operations only.
- [x] Show persisted metadata, recovery explanations, completed-step reuse,
      explicit stale-running recovery confirmation, and clarification as a new
      revised-objective run.
- [x] Implement semantic artifact browsing with on-demand bounded reads,
      scrolling, and safe missing/corrupt-artifact errors.
- [x] Implement research-specific approval, non-empty rejection feedback, and
      leave-waiting behavior without a generic approval abstraction.

#### Verification

- [ ] Port all product and safety scenarios from `test/tui-phase8.test.ts`.
- [ ] Verify history never loads complete event or artifact bodies.
- [ ] Verify completed steps are never silently rerun and resume remains
      attached and cancellable.
- [ ] Run focused application-operation tests and phase-wide static
      verification.

#### Exit Criteria

- [ ] Every persisted run state has an equally safe Ink action or explanation.
- [ ] Artifact and approval behavior remains bounded and workflow-specific.

### Phase 10.6: Formal Parity Gate

#### Tasks

- [ ] Complete the parity matrix with links to passing Ink tests or explicit
      approved deviations.
- [ ] Run equivalent keyboard-only journeys through legacy and Ink for setup,
      launch, completion, cancellation, history, recovery, artifacts, and
      approval.
- [ ] Verify narrow, normal, and wide layouts; scrolling; `NO_COLOR`; resize;
      non-TTY refusal; terminal restoration; signal exit codes; and lazy CLI
      loading.
- [ ] Run the built Linux bundle under a pseudo-terminal and record all startup
      and bundle-size changes.

#### Verification

- [ ] Run all Ink and legacy TUI tests, application tests, CLI protocol tests,
      format, lint, typecheck, full tests, build, bundle build, and
      `git diff --check`.
- [ ] Confirm JSON/JSONL contracts and explicit CLI startup are unchanged.

#### Exit Criteria

- [ ] Every parity row passes or has an explicit accepted deviation.
- [ ] No critical or high-severity lifecycle, data-safety, or compatibility
      defect remains.

### Phase 10.7: Cut Over To Ink

#### Tasks

- [x] Change only the two existing lazy public TUI entry points to load Ink:
      `binaflow tui` and no-argument TTY invocation.
- [x] Keep non-TTY help, JSON/JSONL rejection, and all explicit CLI commands
      unchanged.
- [x] Leave legacy reachable only through an internal test/development path;
      do not expose a public implementation selector.
- [x] Update README only for verified user-visible Ink behavior, including
      scrolling and attached-execution limitations.

#### Verification

- [ ] Test both public entry points from `dist`, explicit CLI commands, JSON,
      JSONL, terminal restoration, cancellation, recovery, and the Linux
      pseudo-terminal bundle.
- [ ] Confirm explicit commands do not load Ink.

#### Exit Criteria

- [ ] Ink is the only supported public TUI and legacy is not user-selectable.

### Phase 10.8: Delete Legacy And Retire This Plan

#### Tasks

- [ ] Delete the legacy TUI renderer, terminal session, controller, legacy-only
      parser tests, internal legacy runner, and utilities made unused by Ink.
- [ ] Keep or replace every product and safety test; no behavior contract may
      disappear solely because Ink renders successfully.
- [ ] Consolidate the final implementation under `src/tui/` if that makes the
      public source layout simpler after deletion.
- [ ] Update `README.md` and `AGENTS.md` with the final verified user-facing
      behavior and architecture, including removal or replacement of the
      `AGENTS.md` session-protocol references that require this `TODO.md`.
- [ ] Delete this `TODO.md` in the final migration commit, as directed by the
      product owner, only after the preceding documentation updates and all
      verification evidence are recorded in the commit history.

#### Verification

- [ ] Search for legacy imports and obsolete test runners.
- [ ] Confirm `AGENTS.md` contains no instruction to read or update `TODO.md`
      before this file is deleted.
- [ ] Run all Ink, application, engine, CLI, and protocol tests; format, lint,
      typecheck, build, bundle build, pseudo-terminal smoke, and
      `git diff --check`.
- [ ] Verify normal exit, errors, SIGINT, SIGTERM, and forced cancellation
      restore the terminal and settle active work safely.

#### Exit Criteria

- [ ] Ink is the sole TUI implementation, all contracts remain protected, and
      no legacy-only code remains.
- [ ] The final commit deletes this temporary plan after all required evidence
      is preserved in code, documentation, tests, and commit history.

## Known Non-Goals

- Detached or background execution.
- Reattachment to a running process.
- Multiple simultaneous runs.
- Daemon or local service.
- Parallel workflow execution.
- Generic plugin framework.
- Generic workflow approval or loop primitives.
- OpenCode or Codex `AgentDriver` implementations.
- Provider credential management.
- Model discovery without a reliable harness API.
- Web interface.
- Remote workers.
- Scheduled execution.
- Runtime-language rewrite.

## Completed History

### QA Corrections

- [x] Use real workflow revisions for resume compatibility.
- [x] Persist complete run input in the `run.input` artifact and restore it on
      resume.
- [x] Complete JSONL failure lifecycle and reject conflicting output modes.
- [x] Normalize invalid invocation exit codes and allow inspection without
      profiles.
- [x] Await JSONL child termination and verify the focused regression suite.

### CLI Protocol v1

- [x] Add versioned JSON results and JSONL execution records for subprocess
      consumers.
- [x] Add structured workflow input, workflow discovery, and artifact retrieval.
- [x] Enforce workflow-version compatibility on resume.
- [x] Harden cancellation and JSONL child-process cleanup.
- [x] Add focused protocol and subprocess contract tests.

### Previous Completed Work

- [x] Improve the CLI with live agent messages, tool activity, step states,
      cancellation handling, actionable summaries, and richer run inspection.
- [x] Validate runtime configuration and required workflow profiles before
      execution.
- [x] Wait for Pi to settle after CLI cancellation before forcing termination.
- [x] Keep completed run inspection independent of current execution profiles.
- [x] Reject unsupported drivers and malformed tool names in configuration.
- [x] Replace local test bundles with rollback-safe directory swapping.
- [x] Defer runtime-heavy CLI imports so help and argument validation do not
      load SQLite, Ajv, Pi, or workflow definitions.
- [x] Add workflow-aware help, actionable `run` errors, and optional
      `binaflow run --interactive` input prompts.
- [x] Verify CLI UX and the full test suite without adding redundant tests.

## Verification Notes

### Phase 3 Baseline And Measurements (2026-08-03)

- Environment: Windows, Node `v22.20.0`, pnpm `11.18.0`; benchmark fixture on
  local NTFS temporary storage.
- Fixture: 100 runs, 1,000 normalized events, 6,900 event-message bytes, and a
  2,277,376-byte database before the event batching comparison. The history
  fixture also included one 1 MiB step result.
- Commands used included `node dist/src/cli/index.js --help`, `--json
workflows`, `--json runs`, `--json show <run-id>`, and `--json show <run-id>
--events`, repeated five to ten times with PowerShell `Measure-Command`.
- Pre-optimization medians were approximately 64 ms for `--help`, 166 ms for
  `--json workflows`, 181 ms for `runs`, 190 ms for default `show`, and 189 ms
  for `show --events`. Component timings were approximately 0.5 ms for config
  loading, 0.7 ms for opening an already-migrated SQLite database, and 40 ms
  for the deterministic fake Pi driver.
- Before indexing, SQLite reported `SCAN runs` and `USE TEMP B-TREE FOR ORDER
BY` for both default and filtered history queries.
- After the history indexes, repeated medians were approximately 181 ms for
  default `runs`, 181 ms for filtered `runs`, and 175 ms for default `show`.
  SQLite reported `SCAN runs USING INDEX runs_by_created` and
  `SEARCH runs USING INDEX runs_by_workflow_created` respectively.
- Persisting 1,000 events through one `saveEvent` call per event took 16,996.67
  ms and grew the database by 90,112 bytes. One transactional `saveEvents`
  batch took 10.32 ms for the same event volume and message shape. This
  justified batching text events while flushing status and error events.
- The native Linux bundle comparison was completed with WSL Ubuntu 24.04,
  Node `v22.23.2`, and the same bundle launched from native `/home` storage and
  mounted `/mnt/d` storage. Median launcher timings were approximately 38 ms
  versus 1,895 ms for `--help`, 96 ms versus 2,208 ms for `--json workflows`,
  103 ms versus 2,522 ms for `runs`, and 105 ms versus 3,098 ms for `show`.
  The difference is filesystem placement, not evidence of a Node runtime
  limitation; no Rust rewrite is justified.

- Baseline verification: format check, lint, typecheck, full tests, and build
  passed before the QA corrections.
- The full Vitest suite previously ran 36 of 38 tests successfully. Two update
  tests fail because Windows symlink creation is denied with `EPERM`; they are
  unrelated to the CLI protocol and QA corrections.
- In this Windows environment, `corepack pnpm run <script>` can fail while
  resolving the nested pnpm executable; direct binaries may be required.
- Built CLI help previously took approximately 0.45-0.51 seconds. The bundled
  Node plus app took approximately 1.09 seconds, and the testrelease launcher
  took approximately 1.16 seconds. The first cold mounted-filesystem run
  reached approximately 2.12 seconds.
- These measurements confirm bundle location and WSL filesystem overhead are
  separate performance factors. Rust is not justified by current evidence.
- Phase 0 verification: `corepack pnpm run format:check` could not run because
  the environment could not resolve the nested `pnpm` executable. The direct
  repository Prettier binary passed for `AGENTS.md`, `README.md`, `TODO.md`,
  and `WISHLIST.md`; `git diff --check` also passed.

## Follow-up

- [x] Compare the testrelease launcher from native Linux storage before making
      a runtime-language decision.

## Current Session Notes

- Phase 0 is completed and verified.
- Phase 1 is completed and verified.
- Focused Phase 1 verification passed: 21 tests across CLI subprocess,
  protocol, CLI, and engine behavior.
- Review remediation R1 and R2 are completed and verified.
- Focused remediation verification passed: 24 tests across CLI subprocess,
  protocol, CLI, and engine behavior.
- Review remediation R3 is completed and verified.
- Focused R3 verification passed: 15 tests across research, engine,
  persistence, and migration behavior.
- Review remediation R4 is completed and verified.
- Focused R4 verification passed: driver, engine, and cancellation tests.
- Review remediation R5 is completed and verified.
- Focused R5 verification passed: metadata, migration, catalog, and inspection
  tests.
- Full suite verification passed 53 of 55 tests. The same two update tests
  remain blocked by Windows symlink `EPERM`; they are unrelated to R5.
- Direct ESLint, TypeScript typecheck, TypeScript build, Prettier, and
  `git diff --check` verification passed. The documented `corepack pnpm`
  resolution issue remains in this environment.
- Stop here for external review before starting Phase 2.
- Phase 2 extraction is completed and verified. Shared application operations
  live in `src/application/operations.ts`; CLI handlers retain parsing,
  signals, and output formatting only.
- Phase 2 focused verification passed: application operation, CLI, protocol,
  and output tests. Full verification passed 56 of 58 tests; the same two
  Windows symlink `EPERM` failures remain unrelated.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, full tests,
  and `git diff --check` verification passed. `corepack pnpm` remains blocked
  by the existing Windows dependency installation permissions/environment.
- Stop here for external review before starting Phase 3.
- Phase 2 review fixes are completed: application objectives are canonical,
  rejection feedback is validated before persistence, and resume progress is
  emitted only for runs that actually resume.
- Added application-boundary tests for run, resume, inspection, approval, and
  rejection behavior, plus CLI regressions for completed and invalid resumes
  and empty approval feedback.
- Fix verification passed 20 focused tests and 64 of 66 full-suite tests. The
  same two Windows symlink `EPERM` failures remain unrelated.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, and focused
  `git diff --check` verification passed.
- Stop here for external review of the Phase 2 fixes before starting Phase 3.
- Phase 3 inspection and performance work is implemented: bounded run history
  with status/workflow filters and stable cursors, compact default inspection,
  explicit full output, history indexes, serialized engine event sinks, batched
  text-event persistence, and child-process lifecycle cleanup.
- Phase 3 focused verification passed 37 tests before the final full suite;
  final full verification passed 70 of 72 tests. The same two Windows symlink
  `EPERM` failures remain unrelated.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, persistence,
  migration, engine, driver, CLI protocol, subprocess, and `git diff --check`
  verification passed.
- Native Linux bundle comparison is complete. WSL Ubuntu 24.04 now uses Node
  `v22.23.2`; the measured regression is caused by `/mnt/d` filesystem access,
  not the runtime language.
- Stop here for external review of Phase 3 before starting Phase 4.
- Phase 4 configuration diagnosis and initialization are implemented through
  shared application operations and CLI commands. `doctor` reports paths,
  profile validation, workflow availability, and Pi launchability without
  claiming authentication or model availability. `init` prompts for provider
  and model names, explains builder permissions, shows the complete proposed
  configuration, refuses existing files, and writes atomically after explicit
  confirmation.
- Phase 4 focused verification passed 21 tests across configuration operations
  and CLI subprocess behavior. Direct Prettier, ESLint, TypeScript typecheck,
  TypeScript build, and `git diff --check` passed.
- Full verification passed 79 of 81 tests. The same two update tests remain
  blocked by Windows symlink `EPERM` at `test/update.test.ts`; they are
  unrelated to Phase 4.
- Stop here for external review of Phase 4 before starting Phase 5.
- Phase 5 adds an attached standard-library TUI shell and home screen in
  `src/tui`, with lazy CLI integration, alternate-screen terminal ownership,
  resize handling, `NO_COLOR`, minimum-size fallback, keyboard navigation, and
  readiness loaded through the Phase 4 application diagnosis operation.
- Dependency spike selected no third-party TUI dependency after evaluating
  `terminal-kit` 3.1.4 and `neo-blessed` 0.2.0. This keeps normal CLI startup
  and the Linux bundle free of TUI dependency overhead.
- Phase 5 focused verification passed 25 CLI/TUI tests, including rendering,
  navigation, non-TTY behavior, terminal restoration, resize, and explicit
  command preservation.
- On Windows Node `v22.20.0`, current built CLI measurements were 71.6 ms for
  `--help`, 173.7 ms for `--json workflows`, and 634,631 bytes for the `dist`
  payload. The Phase 3 approximate baselines were 64 ms and 166 ms; the small
  difference is within process-startup measurement noise and no normal CLI
  path imports `src/tui`.
- Linux x86_64 bundle verification used WSL Ubuntu with Node `v22.23.2`. The
  bundle built successfully, extracted successfully, and its launcher printed
  help. The compressed bundle measured approximately 47 MB and the extracted
  payload 140,236,680 bytes.
- Full Phase 5 verification passed 86 of 88 tests. The same two update tests
  remain blocked by Windows symlink `EPERM` at `test/update.test.ts`; they are
  unrelated to the TUI.
- Stop here for external review of Phase 5 before starting Phase 6.
- Review remediation for Phases 3-5 is implemented. The engine now persists
  terminal failures for missing profiles and event-sink errors; migrations are
  transactional/recoverable; JSONL stdin failures are handled; configuration
  validation and atomic publication are hardened; and TUI shutdown, signals,
  stream errors, split input, and refresh concurrency are covered.
- Focused remediation verification passed 66 tests across engine, migrations,
  JSONL/Pi driver, configuration, CLI subprocess, and TUI behavior.
- Full verification passed 102 of 104 tests. The same two update tests remain
  blocked by Windows symlink `EPERM` at `test/update.test.ts`; no new product
  failures were observed.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, and
  `git diff --check` passed.
- Linux x86_64 bundle was rebuilt with WSL Node `v22.23.2`, extracted, and its
  launcher successfully printed CLI help. The compressed bundle measured
  approximately 47 MB and the extracted payload 140,269,087 bytes.
- Scrolling remains intentionally deferred until a later TUI screen has
  scrollable content; the Phase 5 home screen uses a minimum-size fallback and
  has no unbounded display data.
- Phase 6 adds attached first-run setup, documentation and existing-config
  paths, workflow catalog selection, required/optional input prompts, profile
  and permission review, experimental labeling, cancellation, and workflow
  launch through application operations.
- The TUI refuses to overwrite existing configuration, previews the complete
  generated configuration before writing, and keeps the TUI attached while a
  workflow is running. `q` requests graceful cancellation and signals abort the
  active workflow instead of detaching it.
- Phase 6 focused verification passed 31 TUI/CLI tests, including 6 new setup
  and workflow-launch scenarios.
- Full Phase 6 verification passed 108 of 110 tests. The same two update tests
  remain blocked by Windows symlink `EPERM` at `test/update.test.ts`.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, and
  `git diff --check` passed.
- Linux x86_64 bundle was rebuilt with WSL Node `v22.23.2`, extracted, and its
  launcher successfully printed CLI help. The compressed bundle measured
  approximately 47 MB and the extracted payload 140,353,157 bytes.
- Stop here for external review of Phase 6 before starting Phase 7.
- Phase 7 adds attached live execution and completion screens. Runtime event
  subscriptions feed the TUI without bypassing persisted event storage; redraws
  are throttled while the displayed activity log remains bounded and sanitized.
- Cancellation is graceful on the first request and forceful on the second,
  with terminal restoration and no detach/background action. Completion shows
  terminal status, usage, step outcomes, semantic artifacts, and return-home.
- Phase 7 focused verification passed 28 TUI/application tests, including live
  completion, failure, cancellation, resize, sanitization, and bounded activity.
- Full Phase 7 verification passed 113 of 115 tests. The same two update tests
  remain blocked by Windows symlink `EPERM` at `test/update.test.ts`.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, and
  `git diff --check` passed.
- Stop here for external review of Phase 7 before starting Phase 8.
- Phase 8 adds bounded history and attention views, persisted run detail with
  recovery explanations, safe attached resume, semantic artifact browsing with
  bounded previews and explicit full reads, planner clarification recovery, and
  workflow-specific research approval actions.
- Phase 8 focused verification passed 10 application/TUI tests, including
  history filters and pagination, recovery safety, artifact corruption and
  bounds, approval previews, and attached cancellation.
- Full Phase 8 verification passed 123 of 125 tests. The same two update tests
  remain blocked by Windows symlink `EPERM` at `test/update.test.ts`.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, and
  `git diff --check` passed.
- Stop here for external review of Phase 8 before starting Phase 9.

## Phase 9 Session Notes

- Product polish is implemented across the TUI and human CLI: status labels
  are human-readable, durations and timestamps use shared formatting, short
  IDs are used in lists while detail retains the full ID, and terminal errors
  include a next action.
- Completion screens now distinguish completed, failed, cancelled, waiting,
  and interrupted runs. Unavailable artifact actions are omitted, empty
  artifact states are actionable, and `q` returns home without activating the
  selected artifact action.
- Experimental `research-plan-build` labels are visible in human workflow
  lists, run detail, live/completion views, and approval command help.
- The TUI now preserves the key-hint footer when content exceeds the viewport,
  supports SS3 cursor sequences, honors `NO_COLOR`, and has layout regression
  coverage at 56, 80, and 120 columns. A true scrollable viewport remains a
  documented preview limitation.
- README documentation now covers TUI and CLI journeys, configuration safety,
  JSON/JSONL consumption, attached execution, recovery, experimental approval,
  and preview limitations.
- Focused Phase 9 verification passed 67 tests across TUI, CLI, protocol, and
  presentation behavior.
- Windows performance rerun: warm built-CLI `--help` was approximately
  53-55 ms and `--json workflows` approximately 139-142 ms; cold samples were
  approximately 71 ms and 161 ms. The Linux bundle archive is 48,493,068
  bytes.
- Current storage benchmark persisted 1,000 normalized events in approximately
  9.3 ms and listed the first 20 runs from a 1,001-run database in approximately
  0.63 ms. These are local smoke measurements, not performance targets.
- Linux bundle verification used WSL Ubuntu 24.04 with Node `v22.23.2`, pnpm
  `11.18.0`, and Pi `0.83.0`. The bundle built successfully, its launcher
  printed version/help, `better-sqlite3` loaded from the bundled runtime, and
  the attached TUI launched under a pseudo-terminal and restored the terminal.
- Native `/tmp` bundle smoke timings were approximately 0.03 s, while the
  same bundle executed from `/mnt/d` took approximately 1.56-1.98 s. This is
  accepted WSL mounted-filesystem overhead, not a product regression.
- The optional live Pi E2E was not run because it consumes model requests and
  was not explicitly requested. Pi availability was confirmed, but provider
  credentials/model access were not validated.
- SSH/tmux verification was not run because this Windows session has no remote
  SSH or tmux target. Standard pseudo-terminal bundle smoke passed; unusual
  `TERM` capabilities remain a release follow-up.
- Full verification passed 164 tests with 2 skipped tests. The same two update
  tests remain blocked by Windows symlink `EPERM` at `test/update.test.ts`.
- Direct Windows Prettier, ESLint, TypeScript typecheck, TypeScript build, and
  `git diff --check` passed. WSL `pnpm run` was blocked by its non-TTY attempt
  to purge the existing mounted `node_modules`; the bundle script was run
  directly with the verified WSL Node runtime instead.
- A local Linux x64 test release was built at
  `testrelease/binaflow` with WSL Ubuntu 24.04, Node `v22.23.2`, and pnpm
  `11.18.0`. Its launcher, help output, bundled `better-sqlite3`, and attached
  TUI smoke test passed. The bundle is intentionally ignored and unpublished.

## Phase 10 Session Notes

- Phase 10.0 parity freeze is completed. The matrix covers all 37 meaningful
  legacy TUI tests and 13 user-facing README promises, with implementation-only
  assertions explicitly excluded from behavioral parity.
- Phase 10.0 focused verification passed all 37 TUI and Phase 9 tests.
- Phase 10.0 static verification passed direct Prettier, ESLint, TypeScript
  typecheck, TypeScript build, and `git diff --check`.
- Full verification remains 164 passed, 2 skipped, and 2 Windows symlink
  `EPERM` failures in `test/update.test.ts`; no product failure was introduced.
- No Ink dependency, `src/tui-ink` module, or production Ink route exists yet.
- Phase 10.0 diff review found no remediation items: the change is limited to
  parity planning, baseline evidence, and verified session notes; public routes,
  application boundaries, and CLI contracts remain unchanged.

- Phase 10.1 adds Ink `7.1.1`, React `19.2.8`, and `@types/react` `19.2.2` as
  the only new dependencies. The production CLI still has no import path to
  `src/tui-ink`.
- TypeScript now uses `react-jsx`; existing `.ts` output remains unchanged.
- The internal `src/tui-ink/bootstrap.tsx` uses Ink rendering and input APIs,
  owns only foundation terminal lifecycle, and is not reachable from a public
  command. `scripts/run-tui-ink.mjs` is an internal developer runner.
- Phase 10.1 focused verification passed 7 foundation tests covering TTY
  refusal, input, minimum-size fallback, resize redraw, `NO_COLOR`, stream
  errors, normal unmount, SIGINT, and SIGTERM.
- Full verification passed 171 tests with 2 skipped tests. The same two update
  tests remain blocked by Windows symlink `EPERM` at `test/update.test.ts`.
- Direct Prettier, ESLint, TypeScript typecheck, TypeScript build, and
  `git diff --check` passed. `better-sqlite3` required `corepack pnpm rebuild`
  after the clean Windows dependency installation.
- The Linux x86_64 bundle built with WSL Node `v22.23.2` and pnpm `11.18.0`.
  Verified compressed bundle samples were approximately 50,018,382 bytes and
  the extracted payload was 149,278,141 bytes; the launcher printed help.
  A Python pty smoke launched the bundled Ink foundation, detected its screen,
  sent `q`, and exited with code 0.
- Compared with the Phase 10.0 baseline, warm built-CLI startup remained in
  the same range: `--help` 61.2-69.5 ms and `--json workflows` 178.9-190.2 ms.
- Phase 10.1 diff review found no remediation items. The changes are limited to
  Ink foundation dependencies, TSX configuration, internal foundation lifecycle,
  focused tests, and the internal runner; no public route or application
  operation changed.

- Phase 10.2 adds the internal compositional Ink shell, reusable text/list
  viewport state, dynamic-text sanitization, and focused shell, viewport, and
  text safety tests. The public TUI route remains legacy until Phase 10.7.
- Phase 10.2 focused verification passed 13 Ink foundation, shell, viewport, and
  text tests. The shell tests cover navigation, scrolling, footer visibility,
  resize fallback/redraw, `NO_COLOR`, refresh coalescing, and stale results.
- Phase 10.2 static verification passed direct Prettier, ESLint, TypeScript
  typecheck, and the full Vitest suite except for the same two Windows symlink
  `EPERM` failures in `test/update.test.ts` (177 passed, 2 skipped).
- Phase 10.2 diff review found no remediation items. Ink imports only the
  configuration diagnosis application operation and does not access storage or
  engine internals; no public route or CLI protocol changed.

- Phase 10.3 adds the internal Ink setup and launch-review flow. It reuses
  configuration generation, atomic writes, diagnosis, workflow discovery, and
  `runWorkflow`; application context creation remains deferred until explicit
  launch confirmation.
- Phase 10.3 focused verification passed 5 setup and launch safety tests for
  first-run confirmation, existing-file refusal, workflow grouping, missing
  profiles, input correction, cancellation, write permissions, and profile
  revalidation.
- Phase 10.3 static verification passed repository Prettier, ESLint, and
  TypeScript checks. Full Vitest verification passed 182 tests with 2 skipped;
  the same two Windows symlink `EPERM` failures remain in `test/update.test.ts`.
- Phase 10.3 diff review found no remediation items. The public TUI route and
  CLI protocol remain unchanged; Phase 10.4 is the next active boundary for
  attached execution and completion rendering.

- Phase 10.4 is in progress. The internal Ink shell now has a bounded live
  execution model, sanitized activity, persisted step snapshot refreshes,
  usage/cost aggregation, completion views, attached cancellation, and signal
  routing that avoids blindly unmounting an active run.
- Phase 10.4 focused verification currently passes 2 execution-state tests and
  an attached shell journey covering launch, activity, graceful cancellation,
  and completion. Full verification passes 185 tests with 2 skipped; the same
  two Windows symlink `EPERM` failures remain in `test/update.test.ts`.
- Remaining Phase 10.4 work is resume integration, forced-cancellation cleanup
  ordering, stream-error shutdown, and the complete lifecycle scenario port.
  These remain unchecked until verified; Phase 10.5 owns history and recovery
  presentation needed for a complete resume journey.

- Phase 10.4 resume and Phase 10.5 inspection flows are now implemented in the
  internal Ink shell: history filters/pagination, run detail, recovery actions,
  bounded artifact previews, clarification reruns, and research-specific
  approval/rejection/waiting actions use application operations only.
- The two public TUI entry points now lazy-load `src/tui-ink/shell.tsx`; CLI
  non-TTY, JSON/JSONL, and explicit command tests remain passing. README preview
  text now documents the verified bounded Ink viewports.
- Current full verification passes 186 tests with 2 skipped. The same two
  Windows symlink `EPERM` failures remain in `test/update.test.ts`.
- Phase 10.6 parity evidence and Phase 10.8 legacy deletion remain before the
  migration can be declared final.
- Phase 10.6 static and focused parity checks pass, including TypeScript build,
  CLI protocol tests, Ink foundation/shell/phase tests, and `git diff --check`.
- Docker Desktop Linux x64 rebuilt the bundle with Node 22 and pnpm 11.18.0.
  The archive is `release/binaflow-linux-x64-0.1.0-preview.0.tar.gz`, SHA-256
  `54C9504C983924CD50FED6D5DC98DD5567945499017E18303A3A8248AF9002F0`; its
  extracted launcher passed `--help` smoke verification.
- Local managed-install verification found and fixed a launcher defect: the
  `current` version symlink caused the CLI main-module check to skip execution.
  The CLI now compares canonical entry paths, with a subprocess regression test
  for a symlinked entry directory. A rebuilt bundle was checksum-verified,
  installed under a native WSL test root, and its managed launcher printed its
  version and help successfully.
- Installed-bundle measurements on 2026-08-07: first Ink frame was 252-292 ms
  with a native WSL workspace and 285-311 ms with a `/mnt/d` workspace. With a
  valid configuration, readiness diagnosis was 799-841 ms native and 881-937
  ms mounted. A warm `pi --version` probe took about 480 ms; it is the dominant
  readiness delay after the first frame. In contrast, source development
  `pnpm run cli --help` from `/mnt/d` took 2.55-2.70 s, while installed bundle
  help took 30-40 ms.
- Full verification for the launcher fix passed formatting, linting,
  typecheck, build, the focused symlink regression, bundle construction,
  checksum verification, and installed-launcher smoke. Full Vitest verification
  had three unrelated legacy TUI failures: an Ink setup test expected an
  unwrapped status string, a legacy setup test expected a stale status string,
  and a legacy refresh test timed out after 5 seconds.
- Clarified the Ink missing-configuration screen: the displayed path is the
  expected target, and setup will collect planner and builder settings before
  writing only after confirmation. Focused Ink setup tests and TypeScript
  typecheck passed.
