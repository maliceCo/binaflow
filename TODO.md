# Active Implementation Plan

## CLI Protocol v1

- [x] Add versioned JSON results and JSONL execution records for subprocess consumers.
- [x] Add structured workflow input, workflow discovery, and artifact retrieval.
- [x] Enforce workflow-version compatibility on resume.
- [x] Harden cancellation and JSONL child-process cleanup.
- [x] Add focused protocol and subprocess contract tests.

## Completed

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

- Baseline verification before this session: `corepack pnpm run format:check`,
  `corepack pnpm run lint`, `corepack pnpm run typecheck`, `corepack pnpm
test`, and `corepack pnpm run build` passed.
- CLI protocol verification passes with direct tool invocations on Windows:
  TypeScript, ESLint, Prettier, the focused protocol/engine/driver suite
  (20 tests), and a built `binaflow --json workflows` subprocess check.
- The full Vitest suite runs 32 of 34 tests successfully. Two pre-existing
  update tests fail because Windows symlink creation is denied with `EPERM`;
  they are unrelated to the CLI protocol changes.
- In this Windows environment, `corepack pnpm run <script>` currently fails
  while resolving the nested `pnpm` executable; direct binaries were used for
  current-session verification.
- On repeated checks, the built CLI took approximately 0.45-0.51 seconds for
  `--help` from `/mnt/d/projects/rts/binaflow`. The bundled Node plus app took
  approximately 1.09 seconds, and the testrelease launcher took 1.16 seconds;
  the first cold run reached 2.12 seconds from the same mounted filesystem.
- This confirms that bundle location and WSL filesystem overhead remain a
  separate performance factor; Rust is not justified by the current evidence.

## Follow-up

- [ ] Compare the testrelease launcher from native Linux storage before making
      a runtime-language decision.

## Current Session Notes

- Protocol implementation is complete. Full-suite verification is limited by
  the two Windows symlink permission failures recorded above.
