# Binaflow Remediation TODO

Status: COMPLETE

Executor: Luna

Completion note: All actionable remediation items were implemented and verified
in the working tree on 2026-08-26. The optional live Pi smoke test remains
skipped because this validation does not require a live provider or credentials.

Source: static repository review performed on 2026-08-26. This file is the
implementation scope. Do not add work that is not listed here.

## Goal

Correct the confirmed safety, lifecycle, persistence, recovery, security, TUI,
architecture, and test-quality issues found during the review. Keep the product
small, preserve existing compatibility boundaries, and finish with a smaller,
more valuable test suite.

## Mandatory Rules

- Read `AGENTS.md` before changing code and follow it as the primary project
  instruction.
- Work in the order defined below. Do not start cleanup or test deletion before
  the safety and persistence regressions are protected.
- Make the smallest correct change for each task. Do not add frameworks, plugin
  systems, dependency-injection containers, generic workflow primitives,
  daemons, background execution, or new drivers.
- Do not implement anything from `WISHLIST.md`.
- Do not change protocol-v1 JSON or JSONL envelopes, fields, ordering, stream
  separation, or exit-code behavior.
- Do not make destructive persisted-data changes. Any SQLite schema change must
  be additive and migration-tested. Prefer fixes that need no schema change.
- Do not silently rerun completed steps.
- Do not change `plan-build` behavior or version unless a task explicitly
  requires it.
- If the `research-plan-build` serialized contract or behavior changes, bump its
  workflow version exactly once for this remediation. Existing incompatible runs
  must fail through the existing workflow-version check, not through ad hoc
  compatibility code.
- Do not add a production dependency unless the standard library and existing
  dependencies cannot implement the required behavior. A dependency requires a
  documented concrete reason in the final change summary.
- Do not chase coverage. Every new test must protect a behavior or failure mode
  named in this file.
- Do not retain a test solely because it covers lines. Delete or consolidate
  tests that only verify wording, forwarding, private implementation details, or
  equivalent permutations after the replacement behavior tests pass.
- Do not modify unrelated user changes. Do not commit unless explicitly asked.
- Do not build, package, install, or smoke-test the Linux bundle. The required
  final verification is the normal repository verification listed below.

## Definition Of Done

- Every checkbox in sections 1 through 7 is complete or has a written blocker
  approved by the owner.
- Each confirmed defect has a focused regression test at the lowest useful
  public boundary.
- The test suite is smaller or equal in conceptual scope: new high-value tests
  replace low-value tests instead of accumulating indefinitely.
- Human CLI output is safe, while machine output and explicit raw artifact output
  remain byte-for-byte compatible in structure.
- Cancellation and cleanup never return while accepted event persistence or an
  owned child process is still active.
- Invalid resume and approval validation remain non-mutating.
- All execution writes require a running run owned by the current execution,
  except explicit recovery and approval transactions.
- `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`,
  `pnpm run test`, and `pnpm run build` all pass.

## 0. Baseline And Working Discipline

- [ ] Read `AGENTS.md`, this file, and the production/test files referenced by
      the first task before editing.
- [ ] Inspect `git status --short`, `git diff`, and recent commits. Preserve all
      unrelated existing changes.
- [ ] Run the five normal verification commands before implementation and record
      any pre-existing failures. Do not fix unrelated failures.
- [ ] For every defect, add or adjust the focused regression test first, confirm
      that it fails for the expected reason, then implement the fix.
- [ ] Complete and verify one numbered task before moving to the next. Avoid a
      repository-wide refactor that mixes unrelated findings.

## 1. Process, Stream, And Event Lifecycle

### 1.1 Terminate The Complete Agent Process Tree

Files:

- `src/process/jsonl-process.ts`
- `test/drivers/contract.test.ts`
- a focused fake-process fixture under `test/drivers/` if needed

Required behavior:

- [ ] Change JSONL process ownership so cancellation, timeout, transport failure,
      and explicit termination stop Pi and every descendant process started by
      Pi.
- [ ] On POSIX, own an isolated process group and signal that group. Preserve
      piped stdin/stdout/stderr and attached Binaflow behavior; do not detach the
      workflow from Binaflow lifecycle ownership.
- [ ] On Windows, use the smallest standard-platform process-tree termination
      mechanism available. Do not add a daemon or long-lived helper process.
- [ ] Keep graceful termination first and forced termination second.
- [ ] Do not let `terminate()` resolve until the direct child has exited, or the
      final bounded forced-termination wait has elapsed and a clear termination
      error is available to the owner.
- [ ] Add a deterministic fake Pi that spawns a grandchild which writes a sentinel
      after a delay. Cancel execution and prove the grandchild exits and the
      sentinel is never written.
- [ ] Remove wall-clock assertions such as "under 500 ms" when ordered process
      markers can assert the behavior instead.

Acceptance:

- Cancellation cannot leave a shell/tool descendant modifying the workspace.
- Existing JSONL correlation, stderr capture, timeout, and cancellation behavior
  remains intact.

### 1.2 Drain Accepted Pi Events On Every Exit Path

Files:

- `src/drivers/pi-rpc.ts:59-131`
- `src/process/jsonl-process.ts:73-86`
- `test/drivers/contract.test.ts`

Required behavior:

- [ ] Stop accepting new process messages before final cleanup.
- [ ] Await the complete `eventProcessing` chain on success, process exit,
      cancellation, timeout, event-sink failure, and transport failure.
- [ ] Preserve the first meaningful failure. A cleanup failure may not hide the
      original driver or event-persistence error.
- [ ] Do not close the process or allow the application operation to settle while
      accepted event handlers remain active.
- [ ] Record child exit on `exit`, but do not reject pending requests until stdout
      has been drained and the final decoder input has been processed. Use Node's
      stream/process ordering rather than an arbitrary delay.
- [ ] Add a fake Pi that emits multiple messages and exits before
      `agent_settled`; gate the event sink and prove execution waits for all
      accepted events.
- [ ] Add a fake Pi that writes its final response and exits immediately; prove a
      valid final response is not rejected before stdout drains.

Acceptance:

- No event handler can write SQLite after operation/context cleanup.
- Early process exit still produces the correct driver error when no complete
  response exists.

### 1.3 Persist Buffered Events Even When An Observer Fails

Files:

- `src/application/runtime.ts:105-144`
- `src/core/workflow-runtime.ts:689-717`
- `test/application-runtime.test.ts`

Required behavior:

- [ ] Make serialized sink `flush()` always attempt the underlying durable
      `sink.flush()` after the queue drains, even if an observer/event call has
      failed.
- [ ] Rethrow the first failure only after the durable flush attempt.
- [ ] If both observer processing and durable flush fail, preserve the first
      failure and do not silently discard the second during debugging; use the
      existing error/cause style if one exists, otherwise keep the first error
      without inventing a new error framework.
- [ ] Add a test where text is buffered, the observer fails, and `saveEvents`
      still receives the complete accepted batch before execution rejects.

Acceptance:

- Observer/render failure cannot discard buffered normalized events.

### 1.4 Own CLI Stream Failures Through The Existing Shutdown Path

Files:

- `src/cli/commands/common.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/approval.ts`
- `src/cli/protocol.ts`
- `test/cli-subprocess.test.ts`

Required behavior:

- [ ] Add one small shared attached-CLI lifecycle mechanism for stdout/stderr
      `error` events. Do not create a generic lifecycle framework.
- [ ] On `EPIPE` or another stream failure, capture the first error, abort the
      active controller, await the workflow operation and event persistence,
      remove listeners, close the application context, and only then finish.
- [ ] Preserve protocol-v1 rules. Do not attempt to write a terminal JSONL record
      to a stream that has already failed.
- [ ] Preserve first-signal graceful cancellation and second-signal force intent.
      Force signalling must happen only after operation cleanup and context close.
- [ ] Apply the same owned ordering to `run`, `resume`, `approve`, and `reject`
      without four copied implementations.
- [ ] Add one subprocess test that closes stdout during JSONL execution and proves
      the fake Pi exits and the persisted run is not left running/owned.
- [ ] Add one focused signal-order test covering first signal, second signal,
      operation settlement, context close, and final force signal.

Acceptance:

- Broken output pipes cannot bypass cancellation, persistence, or SQLite cleanup.
- Existing JSON/JSONL output and exit-code tests continue to pass.

### 1.5 Fix Forced TUI Cleanup And Startup Reservation

Files:

- `src/tui/shell.tsx:33-69`
- `src/tui/shell-controller.tsx:551-683`
- `src/tui/lifecycle.ts`
- `test/tui-lifecycle.test.ts`
- `test/tui-ink-shell.test.ts`

Required behavior:

- [ ] Always run `lifecycle.shutdown()` from `runInkShell` even when force was
      requested and Ink rejects. Preserve the original render/stream error.
- [ ] Invoke force signalling only after shutdown completes.
- [ ] Reserve an operation synchronously before calling `openExecutionContext()`
      in launch, resume, and approval paths.
- [ ] Use the lifecycle's synchronous operation state as the authority; do not
      rely only on React's asynchronous `launching` state to reject duplicates.
- [ ] Ensure a rejected duplicate action does not create or replace a context and
      cannot produce an unhandled promise rejection.
- [ ] Track live snapshot/query promises with `lifecycle.trackRequest()` so
      shutdown waits before closing SQLite.
- [ ] Add tests for forced Ink rejection, two immediate submissions, and a gated
      snapshot during shutdown.

Acceptance:

- One user action creates at most one context and one operation.
- Every shutdown path joins operations, requests, subscriptions, and owned
  context closure in that order.

## 2. Persistence, Ownership, Resume, And Recovery

### 2.1 Make Resume Validation Non-Mutating

Files:

- `src/application/execution-operations.ts:55-88`
- `test/application-operations.test.ts`
- `test/persistence.test.ts`

Required behavior:

- [ ] Validate workflow compatibility, persisted input, profiles, and retryable
      work before changing a stale `running` run to `interrupted`.
- [ ] Evaluate stale-running eligibility using a projected interrupted state, or
      require the existing explicit mark-interrupted action. Choose the smaller
      behavior consistent with README recovery documentation; do not silently
      broaden resumability.
- [ ] Perform `markRunInterrupted` only after all non-mutating validation passes.
- [ ] Keep the claim CAS after validation and preserve single-executor behavior.
- [ ] Add a real SQLite test proving an invalid resume leaves run and steps
      byte-for-byte unchanged.

Acceptance:

- Every rejected resume validation is non-mutating.

### 2.2 Require Running Ownership For Execution Writes

Files:

- `src/storage/sqlite-run-store.ts:280-337`
- `src/storage/sqlite-run-store.ts:406-429`
- `test/persistence.test.ts`

Required behavior:

- [ ] In the same transaction as each write, require the run to exist, require
      `run.status === 'running'`, and assert the current execution owner for
      `saveStepRun`, `completeStep`, and `checkpointResearchIteration`.
- [ ] Keep interruption, recovery, and approval decisions in their dedicated
      methods/transactions. Do not weaken them to accommodate the new guard.
- [ ] Verify every legitimate caller performs step/checkpoint writes before the
      run transitions to `waiting`, `failed`, `cancelled`, or `completed`.
- [ ] Add a two-store SQLite test: owner A claims the run; store B cannot save a
      step, complete a step, or checkpoint research; no row or artifact reference
      changes.
- [ ] Retain the atomic `completeStep` rollback test.

Acceptance:

- A stale coordinator cannot mutate execution state after losing ownership.

### 2.3 Test Real Claim Handoff Instead Of Simulating CAS

Files:

- `src/application/execution-operations.ts`
- `src/storage/sqlite-run-store.ts`
- `test/application-operations.test.ts`
- `test/persistence.test.ts`
- `test/research-workflow.test.ts`

Required behavior:

- [ ] Add one integration test using real SQLite and the application operation
      where two resumes compete and only one reaches the fake driver.
- [ ] Add one equivalent approval test covering atomic decision persistence and
      execution-claim handoff. It must use `decideApproval`, not directly rewrite
      the approval step.
- [ ] Prove stale and foreign claim tokens are rejected by the engine/runtime.
- [ ] Delete the fake concurrency tests that manually mutate a local `status` and
      make `assertExecutionClaim` a no-op after the real tests pass.

Acceptance:

- Tests exercise the actual application -> SQLite claim -> runtime boundary.

### 2.4 Clean Up Execution Claims

Files:

- `src/storage/sqlite-run-store.ts:188-193`
- `src/storage/sqlite-run-store.ts:250-275`
- `src/storage/sqlite-run-store.ts:518-527`
- `test/persistence.test.ts`

Required behavior:

- [ ] Delete the in-memory claim token whenever a run leaves `running` and when
      the store closes.
- [ ] Do not delete a valid claim before the final owned transaction finishes.
- [ ] Add a behavior-level test proving a terminalized claim is no longer valid;
      do not expose the private map only for testing.

Acceptance:

- A long-lived TUI cannot accumulate claim tokens for completed runs.

### 2.5 Separate Research Iterations From Execution Attempts

Files:

- `src/application/research-plan-build-coordinator.ts`
- `src/workflows/research-plan-build.ts`
- `src/application/run-view.ts`
- `test/research-workflow.test.ts`
- `test/application-run-view.test.ts`

Required behavior:

- [ ] Persist one workflow-specific research iteration counter that increments
      only after a review requests more research or a human rejection requests a
      new cycle.
- [ ] Do not derive the iteration limit from `StepRun.attempt`; retries and schema
      repair attempts must not consume research iterations.
- [ ] Prefer the existing persisted `run.input` artifact for this counter. Do not
      add a generic loop primitive or a database table for one workflow.
- [ ] Treat the counter as coordinator-owned input: initialize it for a new run,
      validate it on resume, and never trust a user-supplied value to bypass the
      limit.
- [ ] When the limit is exhausted, make recovery and run view report the run as
      terminal and non-resumable. Do not offer a resume action that immediately
      fails again.
- [ ] Keep this logic outside the generic sequential engine.
- [ ] Tighten `researchReviewSchema`: `needs_more_research` requires at least one
      next question; `ready` must not carry next questions.
- [ ] Bump `research-plan-build` workflow version exactly once for the combined
      iteration/schema behavior change.
- [ ] Add tests proving three real cycles are allowed despite technical retries,
      the fourth cycle is refused, exhausted runs expose no resume action, and
      invalid review payloads fail before another research iteration.

Acceptance:

- Research limits count product iterations, not infrastructure attempts.
- Exhausted runs are never advertised or accepted as resumable.

### 2.6 Preserve Infrastructure Failures As Infrastructure Failures

Files:

- `src/core/workflow-runtime.ts:260-329`
- `src/core/workflow-runtime.ts:406-458`
- `src/application/research-plan-build-coordinator.ts:313-332`
- `test/engine.test.ts`
- `test/research-workflow.test.ts`

Required behavior:

- [ ] Narrow retryable step-failure conversion to driver failures and structured
      output/schema failures.
- [ ] Do not label SQLite, artifact filesystem, missing committed artifact,
      event-persistence, or internal consistency failures as
      `AGENT_EXECUTION_FAILED`.
- [ ] Let unexpected infrastructure failures propagate to the application-owned
      interruption/recovery path while preserving their original message/code.
- [ ] Ensure the run is not left owned/running after propagation.
- [ ] Add tests for an artifact read/write failure and an event/storage failure.
      Assert they remain inspectable, are not marked retryable agent failures,
      and cleanup finishes.

Acceptance:

- Resume does not retry an infrastructure corruption as if the agent failed.

## 3. Security And Boundary Correctness

### 3.1 Enforce A Real Read-Only Tool Allowlist

Files:

- `src/config.ts:84-153`
- `src/drivers/pi-rpc.ts:154-172`
- `src/tui/launch.ts:155-170`
- `test/config.test.ts`
- `test/drivers/contract.test.ts`

Required behavior:

- [ ] Define one shared list of currently supported read-only Pi tools:
      `ls`, `find`, and `read`. Empty tool lists remain valid.
- [ ] For `workspaceMode: "read-only"`, reject every configured tool not in that
      allowlist. Do not use a mutating-tool denylist.
- [ ] Use the same classification for config validation, Pi execution validation,
      and TUI permission display.
- [ ] Preserve read-write profiles and their existing tools.
- [ ] Add tests for the three allowed tools, empty tools, known mutating tools,
      and an unknown/custom tool that must be rejected in read-only mode.

Acceptance:

- No profile can be described as read-only while passing an unclassified tool to
  Pi.

### 3.2 Sanitize Human CLI Output Only

Files:

- move/reuse `src/tui/text.ts`
- `src/presentation/`
- `src/cli/commands/common.ts`
- `src/cli/commands/artifact.ts`
- `src/tui/components.tsx`
- `test/cli-output.test.ts`
- `test/tui-ink-text.test.ts`

Required behavior:

- [ ] Move the existing ANSI/OSC/control-character sanitizer to the shared
      presentation layer and reuse it from TUI and human CLI output.
- [ ] Sanitize agent events, objectives, errors, approval feedback, artifact
      previews, and persisted responses before human terminal rendering.
- [ ] Do not sanitize or otherwise change JSON, JSONL, stored artifacts, stored
      events, or explicit `artifact --raw` output.
- [ ] Keep newlines in human output and remove unsafe C0/C1 controls consistently
      with the current TUI behavior.
- [ ] Add focused CLI tests containing CSI, OSC, BEL, DEL, and normal multiline
      text. Keep the existing TUI sanitizer test; do not duplicate every case at
      both layers.

Acceptance:

- Agent-controlled terminal sequences cannot affect the user's terminal in human
  mode, and machine/raw contracts remain unchanged.

### 3.3 Correct Updater Path, Archive, Lock, And Version Validation

Files:

- `src/update/installer.ts:141-177`
- `src/update/installer.ts:200-293`
- `src/update/release-client.ts:111-141`
- `test/update.test.ts`

Required behavior:

- [ ] Remove unconditional case folding from Linux path containment. Use
      `resolve`/`relative` containment with platform-appropriate case semantics.
- [ ] Reject managed links targeting a differently cased sibling such as
      `VERSIONS/...` on Linux.
- [ ] Make stale-lock takeover atomic: atomically rename the stale lock to a
      unique quarantine path before creating a replacement. On a race, restart
      lock ownership validation; never delete another process's newly acquired
      lock.
- [ ] Replace `compareVersions` with a correct SemVer comparison for the version
      syntax already accepted by `isVersion`. Correctly compare multiple
      prerelease identifiers and numeric versus non-numeric identifiers. Do not
      add a SemVer dependency for this narrow supported syntax.
- [ ] Add a valid tar fixture containing `../`, absolute, escaping symlink, and
      escaping hardlink entries. Prove validation rejects each before extraction.
- [ ] Add tests for managed-link escape, stale-lock competition, malicious release
      host, and oversized response.
- [ ] Fix the manifest test so a complete manifest with an invalid `format`
      reaches and asserts the format validation branch.

Acceptance:

- The updater cannot extract or activate content outside managed directories.
- Concurrent stale-lock takeover has one winner.
- Release ordering follows SemVer for all accepted versions.

### 3.4 Align JSONL And Pi Output Bounds

Files:

- `src/process/jsonl-process.ts:5-7`
- `src/process/jsonl-process.ts:170-200`
- `src/drivers/pi-rpc.ts:7`
- `test/drivers/contract.test.ts`

Required behavior:

- [ ] Define compatible transport and agent-result limits. A valid maximum Pi
      result must fit in its enclosing JSONL message, including bounded protocol
      overhead.
- [ ] Split complete lines before checking record size. Enforce the byte limit per
      complete line and on only the remaining unterminated suffix.
- [ ] Keep byte-based UTF-8 limits; do not use JavaScript character count.
- [ ] Add tests for a near-limit valid line followed by another record in the same
      chunk, one oversized complete line, one oversized unterminated suffix, and
      oversized Pi delta/final output producing `PI_OUTPUT_TOO_LARGE`.

Acceptance:

- Valid records are not rejected because later bytes share a chunk.
- Oversized records/results fail deterministically with the intended error.

## 4. Filesystem, Migration, And Compatibility

### 4.1 Make Completed Artifact References Crash-Durable

Files:

- `src/artifacts/file-artifact-store.ts:14-50`
- `src/core/workflow-runtime.ts:292-315`
- `test/artifacts.test.ts`
- `test/engine.test.ts`

Required behavior:

- [ ] Write through an opened temporary file, sync the file before rename, rename
      atomically, and sync the containing directory before returning the artifact
      reference used by SQLite completion.
- [ ] Keep lexical and realpath containment checks.
- [ ] Add fault-injection tests around write/sync/rename/DB completion at the
      narrowest practical boundary. Do not depend on an actual power failure.

Acceptance:

- SQLite cannot commit a completed-step reference before the artifact file and
  directory entry have reached the durability boundary exposed by the store.

### 4.2 Reclaim Only Unreferenced Artifact Files

Files:

- `src/artifacts/artifact-store.ts`
- `src/artifacts/file-artifact-store.ts`
- `src/core/workflow-runtime.ts`
- `src/application/research-plan-build-coordinator.ts`
- `src/storage/sqlite-run-store.ts`
- focused artifact/engine/research tests

Required behavior:

- [ ] Add the narrowest deletion capability required to remove a file created by
      a failed pre-commit operation and a superseded file after its replacement
      transaction commits.
- [ ] Never delete the previously referenced artifact before the new reference is
      committed.
- [ ] On cleanup failure, preserve the committed run state and surface/log the
      cleanup problem using existing error reporting; do not roll back a completed
      transaction by deleting its new artifact.
- [ ] Do not build a generic garbage collector or background cleanup service.
- [ ] Add tests for failed create/complete, successful replacement, failed
      replacement transaction, and research input replacement.

Acceptance:

- Normal retries and research loops do not leak known superseded files.
- A still-referenced artifact is never removed.

### 4.3 Make Bounded UTF-8 Reads Linear And Honest

Files:

- `src/artifacts/file-artifact-store.ts:57-87`
- `test/artifacts.test.ts`

Required behavior:

- [ ] Remove the repeated full-prefix decode loop.
- [ ] Trim only a possible incomplete UTF-8 sequence at the bounded trailing edge.
      Invalid UTF-8 in the retained body must produce an explicit read error, not
      silently discard arbitrary bytes.
- [ ] Set `truncated` when bytes are omitted because of the configured bound or a
      trailing partial code point.
- [ ] Add tests for ASCII, a multibyte code point split at the bound, invalid UTF-8
      near the beginning, and a file exactly at the limit.

Acceptance:

- Bounded reads are O(maxBytes) and never report silently shortened corrupt input
  as complete.

### 4.4 Use A Complete, WAL-Safe Migration Backup

Files:

- `src/storage/migrations/index.ts:11-174`
- `test/migrations.test.ts`

Required behavior:

- [ ] Replace main-file-only copying with SQLite's online backup mechanism, or a
      safely verified checkpoint-and-copy sequence that includes committed WAL
      data. Prefer the SQLite API already available through `better-sqlite3`.
- [ ] Keep backup creation before the destructive legacy rebuild.
- [ ] Expand the oldest supported migration fixture with representative run,
      step result/error, attempt, artifact, event, disposition, skip reason, and
      approval data supported by that source schema.
- [ ] Verify all representable data survives, not only schema version/columns.
- [ ] Remove the artificial "column exists but migration row was deleted" test
      unless code explicitly supports externally corrupted migration metadata as
      a product contract.

Acceptance:

- A migration backup contains all committed data, including WAL-resident pages.
- Migration tests protect data compatibility rather than schema metadata alone.

### 4.5 Keep Historical Run Views Honest

Files:

- `src/application/run-view.ts:112-184`
- `test/application-run-view.test.ts`

Required behavior:

- [ ] Pass the installed workflow into phase/recovery projection only when its
      version matches the persisted run.
- [ ] For missing or incompatible workflows, render only persisted steps as
      `unknown` phases. Do not fabricate pending phases from the current workflow.
- [ ] Do not offer resume or approval actions for incompatible runs.
- [ ] Add one incompatible-version test with changed step IDs.

Acceptance:

- Historical views never claim that unpersisted phases existed.

### 4.6 Stabilize Protocol V1 With Explicit DTO Mapping

Files:

- `src/cli/protocol.ts`
- `src/cli/commands/common.ts`
- `test/cli-protocol.test.ts`
- `test/cli-subprocess.test.ts`

Required behavior:

- [ ] Define explicit protocol-v1 DTOs and mapping functions for run, step,
      artifact, event, error, and terminal records.
- [ ] Initial mapped output must exactly match the current protocol-v1 JSON shape.
- [ ] Do not serialize mutable domain/persistence objects directly after this
      change.
- [ ] Keep exact protocol tests at the DTO/subprocess boundary; remove duplicate
      constructor-level assertions that protect the same shape.

Acceptance:

- Future internal domain fields cannot appear in protocol v1 without an explicit
  mapper change.

## 5. TUI Correctness And Small Efficiency Fixes

### 5.1 Correct Selection, Artifact Opening, Status, And Diagnosis Controls

Files:

- `src/tui/reduce.ts:279-380`
- `src/tui/reduce.ts:519-595`
- `src/tui/viewport.ts`
- `src/tui/shell-input.ts`
- `src/tui/screens/diagnosis.tsx`
- focused reducer/shell tests

Required behavior:

- [ ] Replace `selectionOffset` use with the existing correct
      `moveSelection`/`keepSelectionVisible` behavior so upward movement can
      decrease the offset.
- [ ] When opening artifacts from the result screen, initialize
      `artifactSelected` from the current result selection instead of zero.
- [ ] Clear progress status on authoritative `run-view-set`/`run-finished`
      transitions so completed screens do not retain "Launching", "Resuming", or
      "Approving".
- [ ] Make diagnosis footer controls match implementation. Either wire the
      advertised PageUp/PageDown and back behavior using existing input routing,
      or remove unsupported labels and the unused helper. Choose the smaller
      behavior consistent with other screens.
- [ ] Add one regression test per user-visible behavior; do not add all equivalent
      navigation permutations.

Acceptance:

- Keyboard selection remains visible and Enter opens the visibly selected item.
- Status/footer text describes current behavior only.

### 5.2 Bound Update Memory And Remove Duplicate Release Lookup

Files:

- `src/cli/commands/update.ts`
- `src/update/release-client.ts`
- `src/update/installer.ts`
- `src/update/manifest.ts`
- `test/update.test.ts`

Required behavior:

- [ ] In install mode, let `installUpdate` own release lookup; keep the standalone
      lookup only for `--check`.
- [ ] Stream release content to a staging file while enforcing the response byte
      limit and computing SHA-256. Do not buffer an allowed 512 MiB archive in one
      `Uint8Array`.
- [ ] Hash extracted payload files with streams rather than full-file reads.
- [ ] Preserve checksum, archive validation, staged activation, and rollback
      ordering.
- [ ] Add focused streaming-size and checksum tests without downloading real
      releases.

Acceptance:

- A normal install performs one release lookup and bounded-memory I/O.

### 5.3 Apply Small Proven Efficiency Fixes Only

Files:

- `src/application/config-operations.ts:69-88`
- `src/core/workflow.ts:57-113`
- existing focused tests

Required behavior:

- [ ] Diagnose child folders concurrently with `Promise.all` while preserving
      sorted output and per-entry failure behavior.
- [ ] Reuse one module-level Ajv instance and cache workflow schema compilation by
      schema object. Do not introduce a schema service or dependency injection.
- [ ] Add a test only if behavior could regress; do not test private cache hit
      counts.

Acceptance:

- Behavior is unchanged; repeated static schema compilation and serial directory
  probing are removed.

## 6. Architecture And Dead-Code Reduction

### 6.1 Narrow The Core Store Port And Runtime Exposure

Files:

- `src/core/ports.ts`
- `src/core/engine.ts`
- `src/core/workflow-runtime.ts`
- `src/application/ports.ts`
- `src/application/runtime.ts`
- `src/application/research-plan-build-coordinator.ts`
- `test/architecture-boundaries.test.ts`

Required behavior:

- [ ] Remove approval-specific methods from the core execution-store contract if
      the generic runtime does not consume them. Keep approval claiming on the
      application-owned persistence port.
- [ ] Remove unused core ownership methods from the narrow runtime port.
- [ ] Define one application-owned structural interface containing only the
      runtime operations consumed by `ResearchPlanBuildCoordinator`.
- [ ] Inject `WorkflowRuntime` through that interface and stop publicly exposing
      `WorkflowEngine.runtime` solely for coordinator composition.
- [ ] Keep the research loop explicit and workflow-specific. Do not create generic
      approval, loop, DAG, or coordinator abstractions.
- [ ] Retain AST-based import-boundary tests.

Acceptance:

- Core ports contain only operations consumed by generic core execution.
- Application composition no longer pierces the engine facade's concrete runtime.

### 6.2 Extract Only Existing Cohesive Responsibilities

Files:

- `src/core/workflow-runtime.ts`
- `src/tui/shell-controller.tsx`
- adjacent existing modules

Required behavior:

- [ ] From `WorkflowRuntime`, extract only cohesive output validation/prompt
      preparation if doing so reduces the failure-classification complexity from
      task 2.6. Do not split scheduling/state transitions across services.
- [ ] From `InkShellController`, extract the already duplicated attached-execution
      setup/finalization path and repeated run-view/inspection loading path.
- [ ] Preserve the reducer, attached lifecycle owner, sequential execution, and
      public application facade.
- [ ] Do not add tests for helper names or internal delegation. Existing behavior
      tests must remain sufficient.

Acceptance:

- Lifecycle fixes have one implementation path for launch/resume/approval.
- Every extracted helper has at least two real callers or one clearly isolated
  compatibility/security responsibility.

### 6.3 Remove Confirmed Unused Production Surfaces

Files:

- `src/tui/execution.ts`
- `src/tui/viewport.ts`
- `src/tui/shell.tsx`
- `src/tui/shell-controller.tsx`
- `src/tui/model.ts`
- `src/tui/reduce.ts`
- `src/core/workflow-runtime.ts`
- corresponding tests

Required behavior:

- [ ] Remove `CompletionState` if repository-wide search still shows no consumer.
- [ ] Remove `applyStepSnapshot`, `sumStepTokens`, and `sumStepCosts` if production
      still uses only `applyRunViewSnapshot`.
- [ ] Remove `pageSelection` if task 5.1 does not wire it to real behavior.
- [ ] Remove `hasInjectedContext` if it remains unread.
- [ ] Remove `setup-values` and `open-rejection-feedback` reducer events if no
      production dispatcher exists after the lifecycle/TUI fixes.
- [ ] Remove the unused `runId` parameter from `recordAttemptFailure`.
- [ ] Delete tests whose only purpose was exercising removed, unreachable paths.

Acceptance:

- A repository-wide symbol search finds no stale declarations from this list.
- No supported TUI flow is removed.

### 6.4 Separate Production Build From Test Emission

Files:

- `tsconfig.json`
- new `tsconfig.build.json` only if necessary
- `package.json`

Required behavior:

- [ ] Keep normal typecheck covering source and tests.
- [ ] Make `pnpm run build` emit only production source needed under `dist/src`.
- [ ] Keep declarations/source maps behavior unless changing it is required for a
      source-only build.
- [ ] Do not change bundle scripts beyond pointing them at the corrected build
      output.

Acceptance:

- `dist/test` is not produced by a clean production build.
- `pnpm run typecheck` still checks tests.

## 7. Test Suite Consolidation

Do this section only after sections 1 through 6 pass their focused tests.

### 7.1 Retain These High-Value Contracts

- [ ] Workflow serialization, dependency cycles, and output-reference validation.
- [ ] Plan -> validated plan artifact -> build behavior.
- [ ] Schema repair/failure preventing downstream execution.
- [ ] Cancellation preventing the next step.
- [ ] Resume reusing completed work.
- [ ] SQLite CAS, ownership, atomic `completeStep`, and migration preservation.
- [ ] Research ready/waiting/real approval/iteration-limit behavior.
- [ ] JSONL parsing, correlation, timeout/abort, ordering, and size bounds.
- [ ] Exact protocol-v1 JSON and JSONL subprocess contracts.
- [ ] TUI lifecycle ordering, setup safety, and dynamic-text sanitization.
- [ ] Artifact and updater path/archive security boundaries.
- [ ] One optional live Pi E2E smoke test.

### 7.2 Consolidate Or Remove Low-Value Tests

Files to review, not blindly delete:

- `test/engine.test.ts`
- `test/application-operations.test.ts`
- `test/architecture-boundaries.test.ts`
- `test/cli-output.test.ts`
- `test/cli.test.ts`
- `test/cli-protocol.test.ts`
- `test/tui-ink-shell.test.ts`
- `test/tui-reduce.test.ts`
- `test/tui-ink-viewport.test.ts`
- `test/pi-discovery.test.ts`
- `test/config.test.ts`
- `test/research-workflow.test.ts`

Required changes:

- [ ] Remove exact planner prompt prose and exact event-count assertions when the
      protected behavior is already asserted.
- [ ] Remove direct SQL assertions against private `step_attempts` details from
      engine tests; keep storage-ledger behavior in persistence tests.
- [ ] Replace fake CAS/concurrency implementations with the real integration tests
      from task 2.3.
- [ ] Keep AST import-boundary tests; remove regex tests that parse interface or
      function source text.
- [ ] Reduce exact human-copy tests to one useful rendering/sanitization smoke
      where protocol behavior is not involved.
- [ ] Remove help keyword-list tests.
- [ ] Reduce equivalent unsupported-mode, malformed-tool, corrupt-discovery-file,
      and non-retryable-step permutations to representative boundary cases.
- [ ] Keep reducer tests only for safety-significant transitions and user-visible
      regressions from task 5.1.
- [ ] Fold trivial viewport arithmetic into one behavior regression or remove it.
- [ ] Replace cumulative TUI transcript waits with checkpoints that inspect output
      emitted after the triggering action. Then keep lifecycle cases and one
      approval/recovery journey; remove repeated navigation/copy journeys.
- [ ] Replace real-time duration thresholds with deterministic process/event
      ordering markers.
- [ ] Keep one listener-failure JSONL case at most; prioritize malformed JSON,
      non-object JSON, failed response, timeout, abort, and size behavior.

Acceptance:

- Each remaining test can be explained as protecting a public contract, security
  boundary, lifecycle invariant, persisted compatibility rule, or important user
  flow.
- No remaining test fails solely because harmless wording, formatting, helper
  naming, or private implementation structure changed.

## 8. Final Verification And Report

- [ ] Run focused tests after every numbered task.
- [ ] Run `pnpm run format:check`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run test`.
- [ ] Run `pnpm run build`.
- [ ] Inspect `git status --short` and `git diff --check`.
- [ ] Confirm no generated release, bundle, testrelease, database, artifact, or
      temporary fixture was accidentally added.
- [ ] Confirm protocol-v1 subprocess snapshots/expectations are unchanged except
      for internal DTO mapping implementation.
- [ ] Confirm persisted migration tests open and preserve the oldest supported
      fixture.
- [ ] Confirm `research-plan-build` has exactly one version increment if its
      schema/iteration behavior changed.
- [ ] Update this file as work proceeds: check a task only after its focused tests
      and required verification pass. Do not mark intent as completion.
- [ ] Final report must list: fixed defects, removed/consolidated tests, new
      behavior tests, compatibility-impact decisions, all verification commands,
      and any explicitly approved remaining risk.
