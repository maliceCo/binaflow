# TUI UX Redesign

Execute these phases in order. Do not start the next phase until the current
phase passes verification. Delete this file in the final commit after phase 6
is complete.

## Ground Rules

- Read `AGENTS.md` before making changes.
- Keep the CLI protocol v1, persisted-run compatibility, lifecycle ownership,
  and application/presentation boundaries intact.
- The TUI may use application operations only. It must not read SQLite,
  artifacts, or drivers directly.
- Do not run E2E tests, build bundles, or publish releases.
- At the end of every phase, run:

  ```bash
  pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
  ```

- Fix verification failures before continuing.
- Create one commit per phase. Do not push.
- Stop and ask for guidance if `@inkjs/ui` is incompatible with Ink 7/React 19,
  research profiles require a storage migration, or lifecycle/boundary tests can
  pass only by weakening them.

## Phase 1: Split The TUI Shell

Goal: preserve behavior while replacing fragile input handling and making the
TUI maintainable.

1. Install `@inkjs/ui`; verify it supports the installed Ink 7 and React 19.
2. Split `src/tui/shell.tsx` into per-screen components under
   `src/tui/screens/`: home, documentation, diagnosis, setup, workflows,
   launch, live, completion, history, detail, artifacts, and feedback.
3. Keep `shell.tsx` as the screen-state router and explicit prop coordinator;
   do not add context or dependency injection.
4. Replace the hand-built text prompt with `@inkjs/ui` `TextInput`, preserving
   text sanitization from `src/tui/text.ts`.
5. Keep the existing selection list if `@inkjs/ui` cannot preserve arrows,
   j/k, Enter, and q behavior.
6. Do not change `execution.ts`, `lifecycle.ts`, or `bootstrap.tsx`.

Acceptance: all existing TUI lifecycle tests still pass and `shell.tsx` is
under 400 lines. Commit: `adopt ink ui and split tui screens`.

## Phase 2: Discover Pi Models

Goal: allow setup to show models the user can actually use.

1. In `src/core/agent.ts`, add a narrow optional model-discovery contract
   alongside `AgentDriver`, without changing `execute`.
2. Define provider and model values containing provider, model id, and optional
   display name.
3. Implement Pi discovery in `src/drivers/pi-discovery.ts` by reading
   `~/.pi/agent/auth.json` and `~/.pi/agent/models-store.json`.
4. Return only authenticated providers and their catalogued models. Do not
   download or duplicate models.dev.
5. Return an empty list for missing or invalid files; never throw from
   discovery.
6. Expose this through an application operation in
   `src/application/config-operations.ts`, not directly to the TUI.
7. Add focused fixture tests for normal mapping and missing/corrupt files.

Acceptance: core has no dependency on drivers and discovery degrades to an
empty list. Commit: `add pi model discovery`.

## Phase 3: Novice Onboarding Wizard

Goal: a user with no Binaflow knowledge can create valid configuration without
reading documentation.

1. Replace setup-choice/setup-input/setup-preview with a four-step wizard and
   a visible `Step N of 4` indicator.
2. Step 1: environment diagnosis. Show Pi readiness and offer retry or exit if
   unavailable. Reuse existing application diagnosis and installation text.
3. Step 2: planner provider and model. Use selects when discovery returns
   values; otherwise use text inputs with useful examples.
4. Step 3: builder provider/model plus a clearly explained write-access toggle.
5. Step 4: a human-readable summary card, not raw JSON. Keep the existing
   atomic write and refusal to overwrite config.
6. When no config exists, enter the wizard immediately instead of requiring
   New workflow first.
7. Offer optional configuration of research-plan-build profiles only if the
   existing config schema supports it without a migration.
8. Adapt setup tests and add a text-input fallback test.

Acceptance: an empty temporary workspace can complete setup and diagnosis says
ready. Commit: `add onboarding wizard`.

## Phase 4: Home And Launch

Goal: make the normal path obvious and explain consequences before work starts.

1. Redesign home with a Ready/Attention status badge, its cause and suggested
   fix, New workflow as the selected primary action, and up to three recent
   runs.
2. Add a visible Diagnosis menu route; the existing diagnosis screen must no
   longer be unreachable.
3. Show workflow descriptions and an experimental badge in the workflow picker.
4. Use real text editing for the objective.
5. Present a launch confirmation card with objective, steps/profiles, and a
   clear yellow warning when the builder can modify the current workspace.
6. Keep launch failures in context with Retry and Back actions instead of
   returning home with a raw error line.

Acceptance: navigation tests pass with updated user-facing text only.
Commit: `redesign home and launch screens`.

## Phase 5: Live Progress, Approval, And Completion

Goal: users can see what is happening and make approval decisions confidently.

1. Render a per-step checklist with completed, running spinner, pending, and
   failed states; include duration and cost when available.
2. Preserve `execution.ts` buffering and 50ms coalescing. Keep the bounded
   activity feed and its detail toggle.
3. On an attached run entering `waiting`, present a dedicated approval screen
   with bounded artifact preview and Approve, Reject with feedback, and Leave
   waiting actions. Do not change the workflow engine approval gate.
4. Present completion as a status card with duration, tokens, cost, artifacts,
   and one contextual next action.
5. Separate recovery confirmation (`YES`) from rejection feedback prompts.

Acceptance: lifecycle tests continue to cover graceful and forced cancellation,
stream failure, and ordered cleanup. Commit: `redesign live approval and completion`.

## Phase 6: History And Detail

Goal: previously run workflows are understandable and recoverable.

1. Render history rows with colored status, relative timestamp, workflow, and
   width-truncated objective.
2. Make active status/workflow filters visibly discoverable while preserving
   current keyboard shortcuts.
3. Give history and artifacts useful empty states.
4. Organize detail as Summary, Steps, and Actions, with an explanatory line per
   action.
5. Format artifact sizes in KB/MB.
6. Replace raw user-facing error messages with an explanation and a practical
   next action whenever the context permits.
7. Manually navigate `pnpm run cli -- tui` in a TTY through home, setup in a
   temporary config location, history, detail, and artifacts without crashes.

Acceptance: full verification passes. Delete this file in the same final
commit. Commit: `polish history and detail`.
