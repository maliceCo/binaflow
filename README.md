# Binaflow

> Preview release: `0.1.0-preview.0`

Binaflow is a local workflow orchestrator for coding agents. It runs a
structured workflow, persists runs in SQLite, stores artifacts on disk, and
uses Pi as the first agent driver.

The preview includes two sequential workflows:

- `plan-build`: create a validated implementation plan, then build it.
- `research-plan-build`: research, review, request approval, plan, then build.

This is an early preview. Keep backups of important workspaces and review the
agent profiles before allowing a builder to edit files.

## Requirements

- Node.js 22 or newer
- pnpm, npm, or another Node.js package manager
- Pi installed and available as the `pi` command
- Pi configured with a provider and authenticated credentials

Binaflow does not include an agent model or provider. Pi handles model access,
tool execution, and project trust.

## Install The Preview

Install globally from the npm preview tag:

```bash
pnpm add --global binaflow@preview
```

Check the installation:

```bash
binaflow --help
binaflow --version
```

The preview can also be run without a global installation:

```bash
pnpm dlx binaflow@preview --help
```

## Configure A Workspace

Create `.binaflow/config.json` in the workspace where Binaflow will run:

```json
{
  "dataDir": "./.binaflow",
  "piCommand": "pi",
  "profiles": {
    "planner": {
      "driver": "pi",
      "provider": "your-provider",
      "model": "your-planner-model",
      "tools": ["ls", "find", "read"],
      "workspaceMode": "read-only",
      "timeoutMs": 180000,
      "retryLimit": 0
    },
    "builder": {
      "driver": "pi",
      "provider": "your-provider",
      "model": "your-builder-model",
      "tools": ["ls", "find", "read", "write", "edit", "bash"],
      "workspaceMode": "read-write",
      "timeoutMs": 180000,
      "retryLimit": 0
    }
  }
}
```

Replace the provider and model values with models available in your Pi
configuration. Do not commit credentials or private configuration files.

The planner is read-only. The builder can modify the workspace and run shell
commands, so use a test repository first.

## Run A Workflow

Run the original plan and build workflow:

```bash
binaflow run plan-build --objective "Add input validation to the user API"
```

Useful inspection commands:

```bash
binaflow runs
binaflow show <run-id>
binaflow resume <run-id>
```

Use `--cwd` to run against another workspace or `--config` to select a config
file:

```bash
binaflow --cwd /path/to/project run plan-build --objective "Fix the failing tests"
binaflow --config /path/to/config.json run plan-build --objective "Review the code"
```

Use `--verbose` to display live normalized agent progress:

```bash
binaflow --verbose run plan-build --objective "Add a health check"
```

Run data and artifacts are stored in the configured `dataDir`. Completed steps
are reused when a run is resumed; planning is not silently repeated.

## Research Workflow

The research workflow additionally requires `researcher` and
`research-reviewer` profiles in the config. Start it with:

```bash
binaflow run research-plan-build --objective "Understand the authentication code"
```

When the run waits for human approval, approve it:

```bash
binaflow approve <run-id>
```

Or reject it with feedback for another research iteration:

```bash
binaflow reject <run-id> --feedback "Verify the token refresh path"
```

## Update

Preview releases are installed from the `preview` tag. Update an existing
global installation with:

```bash
pnpm update --global binaflow@preview
```

The local `.binaflow` data directory is not replaced by package updates.

## Development

```bash
pnpm install
pnpm run build
pnpm run cli -- --help
pnpm test
```

The package is published with compiled files from `dist/src`. Pi integration
tests are optional and require a working Pi installation and credentials.

## Preview Limitations

- Pi is the only supported agent driver.
- Execution is local and sequential.
- There is no daemon, web UI, remote worker, or native web search provider.
- The API and persisted data format may change before the stable release.
