# Observable Orchestrator Work Plan

This file is the execution contract for Luna. Follow it in order. Do not add
features, abstractions, dependencies, or cleanup outside the stated scope.

## Objective

Evolve Binaflow toward an observable stateful orchestrator whose CLI, TUI, and
future web presentation can use the same application state and commands.

This work covers the application contract and migration of the existing CLI and
TUI. It does not implement a web server or the proposed review workflow.

## Non-Negotiable Scope

In scope:

- Separate application lifecycle ownership from application use cases.
- Distinguish query capabilities from execution/mutation capabilities.
- Add a serializable, presentation-neutral run view.
- Expose persisted run events through a stable paged cursor.
- Make human CLI output and the TUI consume the observable run view.
- Preserve existing workflow execution, persistence, recovery, and approvals.
- Preserve protocol-v1 JSON and JSONL exactly.

Out of scope:

- HTTP, SSE, WebSocket, browser UI, remote access, or a daemon.
- The new evaluate/propose/review/execute workflow.
- Generic approvals, loops, conditions, DAGs, plugins, or native workflow steps.
- Markdown rendering or editing.
- Artifact revision history or a temporary workspace `TODO.md` feature.
- New agent drivers, model routing, worktrees, or parallel execution.
- Unrelated refactors, naming cleanups, formatting, or test expansion.

## Execution And QA Protocol

Every phase is an independent delivery and must follow this exact cycle:

1. Work only on the current phase.
2. Add or change only tests that protect meaningful behavior or an architecture
   boundary. Do not add coverage-only tests, trivial accessor tests, snapshots
   of large structures, or equivalent permutations.
3. Run targeted tests while implementing.
4. Before presenting the phase for QA, run all required checks:

   ```text
   pnpm run format:check
   pnpm run lint
   pnpm run typecheck
   pnpm run test
   pnpm run build
   ```

5. Mark the phase tasks complete in this file and report:
   - behavior changed;
   - files changed;
   - tests added or changed and why they are valuable;
   - exact verification results;
   - remaining risks or assumptions.
6. Stop. Do not commit and do not start the next phase.
7. The owner will perform QA with Terra and may return a small correction plan.
8. Apply only those corrections, rerun the relevant targeted checks and the
   complete verification gate, then stop for QA again.
9. Commit only after the owner explicitly states that QA is approved and asks
   for the commit. Before committing, inspect `git status`, `git diff`, and
   `git log --oneline -10`; stage only intended files.
10. After the approved phase commit, immediately begin the next phase. Stop
    again when that phase reaches its QA gate.

Luna must never self-approve QA. A green test suite is required but does not
replace the owner's QA decision.

If unexpected user changes appear, preserve them. If they directly conflict
with this work, stop and ask rather than reverting them.

## Architectural Rules

- Persisted run, step, artifact, and event state is authoritative.
- Live events are transient activity, not the source of run state.
- Presentation adapters must not infer available actions from log messages.
- Application DTOs intended for future transports must be JSON-serializable.
- Presentation-neutral DTOs must not expose absolute artifact paths, stores,
  drivers, engines, `Buffer`, Ink types, or Node signal types.
- Keep `NormalizedEvent` as the driver-neutral live event contract.
- Preserve the existing application dependency direction.
- Keep workflow-specific approval behavior workflow-specific.
- Prefer additions that have an immediate CLI or TUI consumer.
- Do not create a generic presentation framework.

## Phase 1: Application Context And Capabilities

### Goal

Separate resource lifecycle from application use cases and make storage-only
contexts unable to expose execution commands at the type level.

### Required Changes

- [x] Introduce explicit application query and command capability interfaces.
- [x] Keep `ApplicationService` as the composed execution-capable facade used by
      attached presentations.
- [x] Introduce an application context object that owns the service and
      `close()`. Remove `close()` from `ApplicationService`.
- [x] Replace the `ApplicationRuntimeContext = ApplicationService` alias.
- [x] Make `openApplicationContext()` return an execution-capable context.
- [x] Make `openApplicationStorage()` return a query-only context.
- [x] Remove the fake storage-only driver path. Opening storage for read commands
      must not construct an engine or workflow coordinator it cannot use.
- [x] Do not expose raw profile configuration as a public service field. Add the
      smallest query DTO needed by current presentation consumers, if any.
- [x] Adapt CLI and TUI context ownership only as needed to compile and preserve
      current behavior. Do not redesign their screens in this phase.
- [x] Keep attached shutdown ordering unchanged: active execution and pending
      reads must finish before the context closes SQLite.

### Valuable Tests

- [x] Query-only contexts do not expose execution commands by contract.
- [x] Closing the context closes resources without making lifecycle part of the
      application service.
- [x] Existing attached lifecycle safety remains covered.
- [x] Architecture tests enforce that lifecycle and infrastructure are not
      exposed on `ApplicationService`.

### Acceptance Criteria

- [x] Read-only CLI commands use query capabilities only.
- [x] Execution commands and the TUI use the execution-capable service.
- [x] No fake driver exists for storage-only operation.
- [x] Existing user-visible behavior and machine protocol are unchanged.
- [x] Full verification gate passes.
- [x] Owner QA approved before commit.

## Phase 2: Observable Run View

### Goal

Provide one application-owned, serializable projection of a run so
presentations do not independently infer phases, state, metrics, or actions.

### Required Changes

- [ ] Add a focused application view module. Keep view construction out of
      `src/core` and out of presentation code.
- [ ] Define a minimal `RunView` containing: - run identity, workflow identity/version, objective, and status; - ordered phase views derived from the installed workflow plus persisted
      step state; - current phase when one is identifiable; - artifact metadata without physical filesystem paths; - aggregate usage, cost, and timing when available; - a discriminated union of currently available concrete actions; - a pending action when the run is waiting.
- [ ] Keep concrete action kinds limited to behavior that exists now, such as
      resume, mark interrupted, and research approval/rejection.
- [ ] Represent unavailable data honestly for legacy runs; do not invent model,
      timing, or cost data.
- [ ] Add a query such as `getRunView(runId)` to application query capabilities.
- [ ] Reuse existing recovery and approval validation rules rather than
      duplicating a second state machine in the view builder.
- [ ] Retain `inspectRun()` where protocol-v1 compatibility still requires the
      existing raw shape. Do not change protocol-v1 output fields.

### Valuable Tests

- [ ] Phase ordering follows the installed workflow definition, including steps
      that do not yet have persisted `StepRun` rows.
- [ ] Current phase and available actions are correct for running, waiting,
      failed/interrupted, and terminal runs without testing redundant status
      permutations.
- [ ] Artifact views omit physical paths.
- [ ] Metrics aggregate only available usage/cost values.
- [ ] Workflow-version incompatibility is represented without crashing or
      claiming invalid actions are available.

### Acceptance Criteria

- [ ] `RunView` can be serialized with `JSON.stringify` without custom handling.
- [ ] It imports no CLI, TUI, Ink, concrete storage, or Pi modules.
- [ ] Presentations can render state and available actions without parsing event
      messages.
- [ ] Existing `inspectRun()` and protocol-v1 behavior remain compatible.
- [ ] Full verification gate passes.
- [ ] Owner QA approved before commit.

## Phase 3: Durable Paged Event Timeline

### Goal

Expose the existing persisted event IDs so future presentations can page and
resume timeline reads without changing live driver events.

### Required Changes

- [ ] Define an application/storage record for a persisted event that includes
      its SQLite event ID and normalized event fields.
- [ ] Add a bounded page query using an `afterId` cursor and a validated `limit`.
- [ ] Order pages strictly by the persisted event ID.
- [ ] Return a next cursor only when more records may be requested.
- [ ] Add `listRunEvents` to application query capabilities.
- [ ] Keep `subscribeEvents` as best-effort attached live activity.
- [ ] Keep `NormalizedEvent` and protocol-v1 JSONL event records unchanged.
- [ ] Do not add a migration: `normalized_events.id` already exists.
- [ ] Avoid loading complete event history for the new query.

### Valuable Tests

- [ ] Paging returns stable, non-overlapping event sequences in ID order.
- [ ] Cursor and limit validation reject invalid values.
- [ ] Events from another run never appear in a page.
- [ ] Existing event persistence and protocol-v1 tests remain unchanged.

### Acceptance Criteria

- [ ] A consumer can read a timeline, retain the last ID, and request only newer
      persisted events.
- [ ] Live text buffering semantics are not presented as durable delivery.
- [ ] No schema or machine-protocol compatibility is broken.
- [ ] Full verification gate passes.
- [ ] Owner QA approved before commit.

## Phase 4: CLI Adapter Migration

### Goal

Make human CLI presentation consume the observable application queries while
preserving all machine contracts.

### Required Changes

- [ ] Use the new application context and capability types consistently.
- [ ] Use `RunView` for human run summaries, phase status, metrics, and next
      actions where it replaces existing duplicated inference.
- [ ] Keep command modules thin and free of workflow state decisions.
- [ ] Keep existing `--json` and `--jsonl` protocol-v1 envelopes, fields,
      ordering, stdout/stderr separation, and exit codes byte-compatible where
      tests define them.
- [ ] Continue using live normalized events for attached progress output.
- [ ] Do not add new CLI commands in this phase.

### Valuable Tests

- [ ] Human output covers the meaningful new phase/action presentation without
      asserting incidental spacing beyond existing conventions.
- [ ] Existing protocol and subprocess tests prove machine output did not change.
- [ ] Read commands can run through query-only contexts.

### Acceptance Criteria

- [ ] Human CLI output no longer computes workflow actions independently.
- [ ] Machine clients observe no protocol-v1 regression.
- [ ] Full verification gate passes.
- [ ] Owner QA approved before commit.

## Phase 5: TUI Adapter Migration

### Goal

Make the existing Ink TUI an adapter over observable application state without
turning this phase into a visual redesign.

### Required Changes

- [ ] Store and render `RunView` rather than raw `RunInspection` wherever the TUI
      needs phase status, metrics, pending action, or available actions.
- [ ] Keep terminal navigation state, offsets, focus, and overlays TUI-specific.
- [ ] Remove workflow decision inference from reducers/controllers when the same
      decision is provided by `RunView`.
- [ ] Refresh the authoritative run view after execution transitions, approval
      decisions, recovery actions, and relevant live activity.
- [ ] Keep live event buffering bounded and use it only for the activity panel.
- [ ] Keep artifact reads and approval commands behind application capabilities.
- [ ] Split controller code only where required to separate application session
      or lifecycle concerns from Ink rendering. Do not rewrite the shell.
- [ ] Preserve keyboard behavior, attached cancellation, setup, recovery, and
      current screens unless a change is required by the new contract.

### Valuable Tests

- [ ] Reducer tests consume explicit available/pending actions instead of
      reproducing domain status rules.
- [ ] Existing lifecycle, cancellation, viewport, and rendering safety tests
      remain green.
- [ ] Add only focused tests for observable-state transitions that previously
      required TUI inference.

### Acceptance Criteria

- [ ] CLI and TUI render the same authoritative phase and action state.
- [ ] TUI logs remain useful but cannot change domain decisions.
- [ ] No Ink or terminal type leaks into application contracts.
- [ ] No visual redesign or new review feature entered the phase.
- [ ] Full verification gate passes.
- [ ] Owner QA approved before commit.

## Phase 6: Documentation And Self-Destruction

### Goal

Document the resulting boundary, perform final cross-adapter QA, and remove this
execution file once the complete initiative is approved.

### Required Changes

- [ ] Update the smallest appropriate existing documentation to describe: - persisted state as the source of truth; - query, command, event, and context ownership boundaries; - CLI and TUI as adapters with shared commands and different UX; - live activity versus durable paged timeline; - future web as a presentation adapter, not implemented functionality.
- [ ] Ensure architecture tests describe the final intended dependency rules.
- [ ] Remove comments or temporary compatibility code introduced only during the
      migration.
- [ ] Do not refactor unrelated documentation or promote wishlist items.
- [ ] Run the complete verification gate.
- [ ] Present the complete initiative for final owner QA with this file still
      present.

### Final QA And Cleanup

After the owner explicitly approves final QA:

1. Delete `TODO.md`.
2. Inspect final `git status`, `git diff`, and recent log.
3. Stage only the intended documentation, architecture-test, and `TODO.md`
   deletion changes.
4. Commit using the repository's established message style.
5. Confirm the worktree contains no unintended files from this initiative.

Do not delete this file before final QA approval. Its deletion is the final
signal that every phase was implemented, reviewed, approved, and committed.

### Acceptance Criteria

- [ ] Documentation matches implemented behavior, not future aspirations.
- [ ] CLI and TUI use the observable application boundary.
- [ ] Protocol-v1 and persisted-run compatibility are preserved.
- [ ] Full verification gate passes.
- [ ] Owner final QA approved.
- [ ] `TODO.md` is deleted and the approved final commit is created.
