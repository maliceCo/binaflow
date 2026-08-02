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

- The release bundle supports Linux x86_64 with glibc
- Pi installed and available as the `pi` command
- Pi configured with a provider and authenticated credentials

Binaflow does not include an agent model or provider. Pi handles model access,
tool execution, and project trust.

## Install The Linux Preview

Preview releases are self-contained Linux x86_64/glibc bundles. They include
the Node runtime and production dependencies, including the Linux
`better-sqlite3` binding. Pi remains an external executable and is not
installed or updated by Binaflow.

GitHub Releases is the only user distribution channel. Development merges to
`main` do not produce user-downloadable builds; download a versioned release
from the repository's **Releases** page.

Download the release asset and verify its SHA-256 checksum:

```bash
version=0.1.0-preview.0
curl -LO "https://github.com/maliceCo/binaflow/releases/download/v${version}/binaflow-linux-x64-${version}.tar.gz"
curl -LO "https://github.com/maliceCo/binaflow/releases/download/v${version}/binaflow-linux-x64-${version}.tar.gz.sha256"
sha256sum -c "binaflow-linux-x64-${version}.tar.gz.sha256"
mkdir -p /tmp/binaflow-install
tar -xzf "binaflow-linux-x64-${version}.tar.gz" -C /tmp/binaflow-install
/tmp/binaflow-install/binaflow/install.sh
export PATH="$HOME/.local/bin:$PATH"
binaflow --version
```

The installer requires no sudo and does not modify a workspace. It stores
versions under `~/.local/share/binaflow/versions`, selects one with the
`current` symlink, and installs the stable launcher at `~/.local/bin/binaflow`.
Set `XDG_DATA_HOME` to change the data root. Keep `$HOME/.local/bin` on PATH.

## Configure A Workspace

Create `.binaflow/config.json` in the workspace where Binaflow will run:

```json
{
  "dataDir": ".",
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

Updates are explicit and only work from the managed bundle installation:

```bash
binaflow update --check --channel preview
binaflow update --channel preview
binaflow update --rollback
```

The updater downloads the canonical GitHub Release over HTTPS, verifies the
SHA-256 sidecar, validates the bundle, and atomically switches `current`.
Previous versions are retained. Direct source or package-manager executions
refuse self-update. The updater never opens or migrates `runs.db` and does not
change `.binaflow`, configured `dataDir`, or artifacts.

## Development

```bash
pnpm install
pnpm run build
pnpm run cli -- --help
pnpm test
pnpm run build:bundle
```

Development requires Node.js 22 or newer and pnpm. Pi integration tests are
optional and require a working Pi installation and credentials.

## Preview Limitations

- Pi is the only supported agent driver.
- The preview release supports Linux x86_64/glibc only.
- Execution is local and sequential.
- Updates use HTTPS and SHA-256; signed manifests are reserved for a stable release.
- There is no daemon, web UI, remote worker, or native web search provider.
- The API and persisted data format may change before the stable release.
