---
name: binaflow-test-release
description: Use when the user says "haz un release de test" or asks to create a local Binaflow test bundle without GitHub publication.
---

# Binaflow Test Release

Use this skill only for a local Linux x64 test bundle. It produces the ignored
`testrelease/binaflow` directory and never creates a commit, tag, push, GitHub
Release, GitHub Actions artifact, or workspace configuration.

## Procedure

Run these checks from the repository root:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build:testrelease
```

Then smoke-test the generated bundle with its bundled runtime:

```bash
bundle="$PWD/testrelease/binaflow"
"$bundle/bin/binaflow" --version
"$bundle/bin/binaflow" --help >/dev/null
(
  cd "$bundle/app"
  "$bundle/runtime/bin/node" -e "import('better-sqlite3').then(() => process.exit(0))"
)
```

If any command fails, report the failure and do not describe the test release
as ready. Do not run the optional live Pi E2E suite unless the user explicitly
asks for it.

## Response

On success, provide only the absolute bundle path and these commands, replacing
the path with the actual output:

```bash
/absolute/path/to/testrelease/binaflow/bin/binaflow --cwd /path/to/project --version
/absolute/path/to/testrelease/binaflow/bin/binaflow --cwd /path/to/project runs
```

Explain that the target project needs its own `.binaflow/config.json` and that
the direct bundle cannot run `binaflow update`; updates require an installation
made by `install.sh`.
