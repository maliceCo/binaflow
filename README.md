# Binaflow

> Preview release: `0.1.0-preview.0`

Binaflow is a local workflow orchestrator for coding agents. It runs a
structured workflow, persists runs in SQLite, stores artifacts on disk, and
uses Pi as the first agent driver.

The preview includes two sequential workflows:

- `plan-build`: create a validated implementation plan, then build it.
- `research-plan-build`: experimental research, review, approval, plan, then
  build.

For human users, Binaflow provides an attached terminal UI (TUI) with workflow
menus, setup assistance, live progress, artifact browsing, recovery, and clear
permission confirmations. The CLI remains the stable interface for scripts,
plugins, and other automation.

The integration boundaries are intentionally separate:

```text
Human user -> TUI -> Binaflow application operations -> workflow engine
Script/plugin -> CLI JSON or JSONL -> Binaflow application operations
Workflow step -> AgentDriver -> Pi (current) or future harness driver
```

A plugin that invokes Binaflow consumes the CLI protocol; Binaflow does not
expose a generic plugin API. That is different from Binaflow invoking OpenCode
or Codex as an agent driver; those drivers are future integrations and are not
included in this preview milestone.

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

## Local Test Release

Developers can build an unpacked local bundle without GitHub, a tag, or an
installation:

```bash
pnpm run build:testrelease
```

This replaces the ignored `testrelease/binaflow` directory. Run it against any
workspace by using its absolute path:

```bash
/path/to/binaflow/testrelease/binaflow/bin/binaflow --cwd /path/to/project runs
```

The workspace still supplies `.binaflow/config.json`, its run database, and
artifacts. This direct local bundle is not a managed installation, so
`binaflow update` is intentionally unavailable.

## Configure A Workspace

The safest setup path is to diagnose first, then initialize only when the
configuration is missing:

```bash
binaflow doctor
binaflow init
```

The attached TUI offers the same setup and diagnosis operations. `init` never
overwrites an existing file, displays the complete proposed configuration,
and writes it only after explicit confirmation. `doctor` checks configuration,
profile validity, workflow availability, and whether Pi can launch; it does
not verify provider authentication or model availability.

By default Binaflow reads `.binaflow/config.json` relative to the workspace.
Use `--cwd` to select the workspace and `--config` to select another config
file. A relative `dataDir` is resolved from the workspace, not from the
process directory.

The generated configuration has this shape:

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
configuration. Binaflow asks for names but does not store credentials or
manage authentication. Do not commit private configuration files.

The planner is read-only. The builder can modify the workspace and run shell
commands, so use a test repository first.

## Run A Workflow

For a human session, run `binaflow` with no arguments in a TTY or use
`binaflow tui`. The TUI guides setup, workflow selection, input validation,
permission review, attached live execution, completion, history, recovery,
approval, and artifact browsing. Use `j`/`k` or the arrow keys to move, Enter
to select, and `q` to go back or leave the current screen. `Ctrl-C` requests
graceful cancellation during execution; a second request force-cancels.

Non-TTY no-argument invocation shows CLI help. The TUI does not run workflows
in the background or reconnect to a detached process; the explicit CLI
commands below remain the stable automation interface.

For an explicit CLI session, diagnose the workspace, discover a workflow, run
it, inspect its result, and resume only when the persisted state allows it:

```bash
binaflow doctor
binaflow workflows
binaflow run plan-build --objective "Add input validation to the user API"
binaflow runs
binaflow show <run-id>
binaflow artifacts <run-id>
binaflow resume <run-id>
```

## Consume The CLI

The CLI has a versioned subprocess protocol for LLMs, scripts, and other
applications. Human-readable output remains the default.

Supported output modes are intentionally narrow:

| Command family                                                 | JSON | JSONL | Human-only behavior |
| -------------------------------------------------------------- | ---- | ----- | ------------------- |
| `workflows`, `runs`, `show`, `artifacts`, `artifact`, `doctor` | Yes  | No    | -                   |
| `run`, `resume`, `approve`, `reject`                           | Yes  | Yes   | `run --interactive` |
| `tui`, `init`                                                  | No   | No    | Interactive only    |

JSONL is an execution stream, not a general listing format. Its stdout
contains only `run.started`, normalized `event`, and terminal `run.finished` or
`run.failed` records. A failure before a run exists is a standalone `error`
record. Human progress and diagnostics remain on stderr.

Use JSON for inspection and discovery. JSON output is one document on stdout;
diagnostics remain on stderr:

```bash
binaflow --json workflows
binaflow --json runs
binaflow --json show <run-id> --events
binaflow --json artifacts <run-id>
binaflow --json artifact <run-id> plan.plan
```

Every JSON result has `protocol: "binaflow-cli"`, `version: 1`, `type:
"result"`, a command name, and command-specific `data`. Errors use the same
protocol with `type: "error"` and a structured `error.code` and
`error.message`.

`doctor --json` can return a valid result and exit with code `1` when its
`ready` field is false. This is a diagnosis result, not a protocol failure.

Use JSONL for execution. stdout contains only protocol records, one per line:
`run.started`, `event`, and `run.finished`. Agent activity is structured in
the `event` record, with a monotonically increasing stream `sequence`, and is
never mixed into the result:

```bash
binaflow --jsonl run plan-build --input-json objective.json
binaflow --jsonl resume <run-id>
```

`--input-json` accepts a JSON object from a file or `-` for stdin. The
`objective` property is required by the current workflows; `--objective`
remains the convenient short form and overrides the JSON object's objective.
The complete input is persisted as the `run.input` JSON artifact and is the
source used by `resume`, `approve`, and `reject`. Use `artifacts` to list
references and `artifact` to retrieve one exact artifact. `artifact --raw`
writes only its content and cannot be combined with `--json` or `--jsonl`.

The CLI exit codes are: `0` for a successful command (including a run waiting
for approval), `1` for execution or operational failure, `2` for invalid
invocation or input, and `130` for graceful cancellation. `--json` and
`--jsonl` are mutually exclusive. A persisted run can only be resumed with
the same workflow revision; increment the workflow's `version` when changing
its behavior or input/output contract incompatibly. JSONL executions end with
`run.finished` or `run.failed` after `run.started`; failures before a run is
created use a standalone `error` record.

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

Normal execution also shows compact live activity on the terminal: agent
messages, step states, tool activity, and errors. The final run summary is
written to stdout; live activity is written to stderr so scripts can capture
the result separately. `--verbose` keeps the raw event types and protocol
detail. Press `Ctrl-C` once to request a graceful cancellation; Binaflow gives
Pi up to five seconds to settle before terminating it. Press it again only when
the agent does not stop.

The run ID is printed as soon as execution starts. Failed retryable runs show
the exact `resume` command in their summary. Inspect a run without dumping all
of its event history:

```bash
binaflow show <run-id>
binaflow show <run-id> --events
```

The default `show` output includes the objective, timestamps, step attempts,
step metadata, and artifact paths. Use `--full-output` for complete persisted
agent step results and `--events` for the complete normalized event history.
`runs` supports `--limit`, `--status`, `--workflow`, and `--cursor`; it displays
human-readable timestamps and short IDs while `show` retains the full ID.
Configuration errors and missing workflow profiles are reported before an
agent step starts.

Run data and artifacts are stored in the configured `dataDir`. Completed steps
are reused when a run is resumed; planning is not silently repeated.

## Attached Execution And Cancellation

TUI and explicit CLI execution stay attached to the current process. There is
no detach action, daemon, background worker, or reconnection protocol. The
first `q` or `Ctrl-C` requests graceful cancellation; a second request force-
cancels. CLI execution gives Pi up to five seconds to settle.

A process can leave a persisted run marked `running` after abnormal
termination. After confirming that the original process has stopped, use the
TUI attention view to mark it interrupted before recovery. Binaflow never
silently reruns completed steps.

## Recovery

Retryable failed, interrupted, and pending work can be resumed. Completed
steps and their persisted artifacts are reused. Cancelled and completed runs
cannot be resumed, waiting runs use the research-specific approval actions,
and workflow-version mismatches block recovery. Planner clarification starts a
new run with a revised objective rather than changing the existing run.

## Research Workflow (Experimental)

The research workflow additionally requires `researcher` and
`research-reviewer` profiles in the config. Start it with:

```bash
binaflow run research-plan-build --objective "Understand the authentication code"
```

When the experimental run waits for human approval, approve it:

```bash
binaflow approve <run-id>
```

Or reject it with feedback for another experimental research iteration:

```bash
binaflow reject <run-id> --feedback "Verify the token refresh path"
```

Approval, rejection, and the bounded research loop are specific to
`research-plan-build`; they are not generic workflow-engine primitives.

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
- The TUI is attached to the current terminal; detached execution and
  reconnection are not supported.
- Updates use HTTPS and SHA-256; signed manifests are reserved for a stable release.
- There is no daemon, web UI, remote worker, or native web search provider.
- `research-plan-build` and its approval flow are experimental; approval and
  loop behavior are not generic workflow primitives yet.
- TUI screens provide bounded list and text viewports with keyboard scrolling;
  execution remains attached to the current process.
- Artifact previews are bounded. JSON previews are limited to 4,000 bytes and
  displayed artifact content to 8,000 characters; use the CLI `artifact`
  command for unrestricted retrieval. TUI full view does not bypass terminal
  display limits.
- `NO_COLOR` disables SGR color sequences but does not disable the alternate
  screen or cursor control required by the attached TUI.
- Pi launchability is probed, but authentication and model availability are
  not verified by Binaflow.
- Superseded `run.input` files are retained until a future safe artifact
  garbage-collection policy exists.
- The API and persisted data format may change before the stable release.
- The CLI subprocess protocol is versioned independently, but version 1 is
  still preview API and may change before the stable release.
