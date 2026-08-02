---
name: binaflow-github-release
description: Use when preparing, verifying, or publishing a Binaflow Linux bundle through GitHub Releases and a v<version> tag.
---

# Binaflow GitHub Release

Use this skill for the Binaflow Linux x64/glibc release process. Binaflow is
published as a self-contained GitHub Release bundle, not to npm.

The GitHub Actions workflow at `.github/workflows/release.yml` runs when a
`v*` tag is pushed. It verifies the tag against `package.json`, runs checks,
builds the bundle, smoke-tests it, creates the GitHub Release, and uploads:

```text
binaflow-linux-x64-<version>.tar.gz
binaflow-linux-x64-<version>.tar.gz.sha256
```

## Scope And Safety

- Release targets only Linux x86_64 with glibc.
- The bundle includes Node.js and the Linux `better-sqlite3` binding.
- Pi remains external and is never packaged, installed, or updated.
- Preview releases use HTTPS and SHA-256 sidecars. Signed manifests are not
  implemented yet; do not describe preview assets as signed.
- `main` is the only release source. The workflow rejects a tag whose commit
  is not already reachable from `origin/main`.
- A pushed tag creates a public release. Never create a tag, push a branch, or
  push a tag without the user's explicit confirmation in the current session.
- Do not use npm publishing, GitHub Packages, `pnpm publish`, or manually
  upload different asset names.
- Do not create GitHub Actions artifacts for merges to `main`. GitHub Releases
  are the only user-facing distribution channel.

## Preconditions

Confirm before preparing a release:

1. The worktree contains only intended changes.
2. `package.json` has the target version, for example `0.1.0-preview.1`.
3. The target tag will be exactly `v<package-version>`.
4. The target commit is already integrated into `main`.
5. The GitHub remote points to `maliceCo/binaflow`.
6. The user has explicitly approved the release tag and push.

Inspect without modifying anything:

```bash
git status --short
git remote -v
git branch --show-current
git merge-base --is-ancestor HEAD origin/main
node -p "require('./package.json').version"
git log --oneline -10
```

Do not release from a dirty worktree. Commit only after explicit user approval.
Before a tag is created, inspect the branch, target commit, status, and diff.

## Local Verification

Run all required verification commands from the repository root:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:integration
pnpm run build:bundle
git diff --check
```

`test:integration` is the opt-in live Pi suite. If it is skipped because the
environment variables were not supplied, record it as skipped rather than as
a live Pi pass.

The bundle command produces ignored local files in `release/`. Validate the
exact versioned archive with its bundled runtime:

```bash
version="$(node -p "require('./package.json').version")"
archive="release/binaflow-linux-x64-${version}.tar.gz"
sha256sum -c "${archive}.sha256"
smoke="$(mktemp -d)"
trap 'rm -rf "$smoke"' EXIT
tar -xzf "$archive" -C "$smoke"
"$smoke/binaflow/bin/binaflow" --version
"$smoke/binaflow/bin/binaflow" --help >/dev/null
(
  cd "$smoke/binaflow/app"
  "$smoke/binaflow/runtime/bin/node" -e "import('better-sqlite3').then(() => process.exit(0))"
)
```

The output of `--version` must exactly match `package.json`.

## Release Procedure

After the user explicitly approves publishing:

1. Commit the verified release changes using the repository's existing commit
   style.
2. Merge the release commit into `main` and push `main`.
3. Create an annotated tag matching `package.json` exactly on that `main`
   commit.
4. Push only that tag.
5. Monitor the GitHub Actions Release workflow.
6. Inspect the resulting GitHub Release and its two exact assets.

Commands, substituting the verified version:

```bash
version="$(node -p "require('./package.json').version")"
git switch main
git pull --ff-only origin main
git tag -a "v${version}" -m "Release v${version}"
git push origin "v${version}"
gh run list --workflow release.yml --limit 1
```

Do not use `--force`, move an existing tag, amend a release commit, or create
an empty release. If the tag already exists, stop and ask the user how to
proceed.

## Workflow Validation

The release workflow must show all of these steps succeeding:

1. Tagged commit is reachable from `main` and its version equals `package.json`.
2. Formatting, linting, type checking, and unit tests pass.
3. The Linux x64 bundle builds successfully.
4. The extracted bundle runs `--version`, `--help`, and imports
   `better-sqlite3` using the bundled Node runtime.
5. The GitHub Release has the archive and its `.sha256` sidecar.

For a version containing `-`, the workflow marks the release as a prerelease.
Stable versions have no hyphen. The workflow uses the current GitHub
repository, so verify the remote before tagging.

## Failure Handling

- If local verification fails, fix the failure and rerun all relevant checks.
- If CI fails before publishing, inspect the failed workflow logs; do not
  publish assets manually as a workaround.
- If the release workflow creates no release, do not retag or force-push.
  Determine whether the workflow failed before the publish step.
- If the release exists but assets are incomplete, stop and report the exact
  state. Do not overwrite assets or replace the tag without explicit user
  direction.
- Keep workspace `.binaflow` data, configured data directories, runs, and
  artifacts outside the release process.

## Post-Release Check

After a successful release, verify the public archive URL and checksum before
announcing it. Then install it in a temporary user-local root and run
`binaflow --version`. This checks the same bundle users receive without
touching an existing managed installation.
