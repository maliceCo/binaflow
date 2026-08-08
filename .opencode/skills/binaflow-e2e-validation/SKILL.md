---
name: binaflow-e2e-validation
description: Use when running or diagnosing Binaflow live E2E validation, Pi availability, WSL PATH issues, or the opt-in plan-build fixture.
---

# Binaflow E2E Validation

Use this skill only for the opt-in live E2E validation of Binaflow. The E2E
fixture uses the real CLI and Pi against a temporary workspace. It is not part
of the normal unit test suite and consumes model requests.

## Execution Environment

Run from WSL as the project user, not from a Windows Node installation and not
from a different WSL user. The expected environment is:

- Distribution: `Ubuntu-24.04`
- User: `carlos`
- Workspace: `/mnt/d/projects/rts/binaflow`
- Node.js: version 22 or newer
- `pnpm`: available from the user's pnpm installation
- `pi`: available from the user's Pi installation

When starting from Windows PowerShell, use an interactive WSL shell so the
user's `nvm` and pnpm paths are loaded:

```powershell
wsl.exe --distribution Ubuntu-24.04 --user carlos --cd /mnt/d/projects/rts/binaflow bash -ic 'command -v node; node --version; command -v pnpm; pnpm --version; command -v pi; pi --version'
```

Do not use `npm list -g` to decide whether Pi is installed. Pi may be installed
under `~/.local/share/pnpm/bin` and need not be an npm global package.

If the checks do not show Node 22, pnpm, and Pi, stop and report an environment
blocker. Do not claim that the E2E passed and do not mark a TODO item complete.

## Provider And Credentials

Pass the E2E variables explicitly for every invocation. They are not expected
to exist permanently in the shell environment:

- `BINAFLOW_E2E=1` enables the live test.
- `BINAFLOW_E2E_PROVIDER` fixes the Pi provider and prevents ambiguous model resolution.
- `BINAFLOW_E2E_PLANNER_MODEL` is required.
- `BINAFLOW_E2E_BUILDER_MODEL` is optional; set it when verifying separate model assignments.

For the known local Pi setup, `gpt-5.6-luna` is provided by `openai-codex`, not
the Azure provider. Confirm before running without exposing credentials:

```bash
pi --list-models gpt-5.6-luna
pi auth print-bearer-token --provider openai-codex --model gpt-5.6-luna >/dev/null
```

If authentication fails, report the provider and credential error only. Never
print API keys or bearer tokens. Use Pi's login flow or the user's configured
credential mechanism outside the repository.

## Commands

Run normal tests separately first:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
```

Run the live fixture only on explicit request:

```bash
BINAFLOW_E2E=1 \
BINAFLOW_E2E_PROVIDER=openai-codex \
BINAFLOW_E2E_PLANNER_MODEL=gpt-5.6-luna \
pnpm run test:e2e
```

To verify separate planner and builder models, use models selected by the
user:

```bash
BINAFLOW_E2E=1 \
BINAFLOW_E2E_PROVIDER=openai-codex \
BINAFLOW_E2E_PLANNER_MODEL=<planner-model> \
BINAFLOW_E2E_BUILDER_MODEL=<builder-model> \
pnpm run test:e2e
```

Prefer `pnpm run test:e2e` because it builds the CLI before running the E2E
suite. The suite creates and removes its own temporary fixture. It verifies
the normal plan-build flow, CLI artifact inspection, and interruption/resume.

`pnpm run test:integration` is an alias for the same opt-in E2E command.

## Result Interpretation

- `2 passed`: live plan-build and interruption/resume validation passed.
- `1 skipped`: the opt-in gate was not enabled; this is not a live validation.
- Missing Pi, Node, pnpm, provider, model, or credentials: blocked; do not mark the E2E complete.
- A failed CLI, artifact assertion, or resume assertion: investigate the application and preserve the failure details.

Do not use prior session notes as proof that the current environment passed.
Only the current command output is evidence for a live E2E result. When the
verification is genuinely completed, record the exact WSL environment,
provider, model assignments, and command outcome in the session report.
