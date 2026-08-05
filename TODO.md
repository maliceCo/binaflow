# Active Implementation Plan

This plan is the execution contract for the consumer-facing Binaflow
milestone. Work through phases in order. Complete and verify one phase before
starting the next phase. At the end of every phase, stop for external review.

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

## Instructions For Luna

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
- [ ] Stop for external review after each completed phase.

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
