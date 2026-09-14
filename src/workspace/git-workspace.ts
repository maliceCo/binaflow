import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type {
  GuidedCommitInspection,
  GuidedExecutionCommitIntent,
  GuidedExecutionGitState,
} from '../application/guided-execution.js';
import type { GitWorkspace } from '../application/ports.js';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_GIT_PATHS = 1_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export class GitWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitWorkspaceError';
  }
}

export class LocalGitWorkspace implements GitWorkspace {
  constructor(private readonly timeoutMs = 30_000) {}

  async inspect(workspace: string): Promise<GuidedExecutionGitState> {
    const root = await this.repositoryRoot(workspace);
    const branch = await this.gitOptional(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
    const head = await this.git(root, ['rev-parse', '--verify', 'HEAD']);
    const changes = await this.changes(root);
    return { workspace: root, branch, head, clean: changes.length === 0, changes };
  }

  async preflight(workspace: string): Promise<GuidedExecutionGitState> {
    const root = await this.repositoryRoot(workspace);
    const bare = await this.git(root, ['rev-parse', '--is-bare-repository']);
    if (bare !== 'false')
      throw new GitWorkspaceError('guided execution requires a non-bare repository');
    const state = await this.inspect(root);
    if (!state.branch) throw new GitWorkspaceError('guided execution requires a local branch');
    if (!state.head) throw new GitWorkspaceError('guided execution requires an existing HEAD');
    const gitDir = await this.gitDirectory(root);
    for (const marker of [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-apply',
      'rebase-merge',
      'sequencer',
    ]) {
      if (await exists(join(gitDir, marker))) {
        throw new GitWorkspaceError(`repository operation is in progress: ${marker}`);
      }
    }
    if ((await this.gitOptional(root, ['config', '--get', 'core.sparseCheckout'])) === 'true') {
      throw new GitWorkspaceError('sparse checkout is not supported for guided execution');
    }
    const fileFlags = await this.git(root, ['ls-files', '-v']);
    if (fileFlags.split('\n').some((line) => line.startsWith('h ') || line.startsWith('S '))) {
      throw new GitWorkspaceError('assume-unchanged or skip-worktree files are not supported');
    }
    const worktrees = await this.git(root, ['worktree', 'list', '--porcelain']);
    if (worktrees.split('\n').filter((line) => line.startsWith('worktree ')).length > 1) {
      throw new GitWorkspaceError('linked worktrees are not supported for guided execution');
    }
    if ((await this.git(root, ['submodule', 'status', '--recursive'])).trim()) {
      throw new GitWorkspaceError('submodules are not supported for guided execution');
    }
    if (state.changes.some((change) => change.status.includes('U'))) {
      throw new GitWorkspaceError('repository has unresolved merge conflicts');
    }
    if (!state.clean) throw new GitWorkspaceError('repository index and worktree must be clean');
    return state;
  }

  async validatePaths(workspace: string, paths: readonly string[]): Promise<void> {
    if (paths.length > MAX_GIT_PATHS) {
      throw new GitWorkspaceError(`Git path limit exceeded: maximum is ${MAX_GIT_PATHS}`);
    }
    const root = await this.repositoryRoot(workspace);
    for (const path of paths) {
      validateRelativePath(path);
      if (path.split('/')[0] === '.git' || path.split('/')[0] === '.binaflow') {
        throw new GitWorkspaceError(`path is reserved: ${path}`);
      }
      const target = resolve(root, path);
      const parent = dirname(target);
      await assertNoSymlink(root, parent);
      const parentReal = await realpath(parent).catch(() => {
        throw new GitWorkspaceError(`path parent does not exist: ${path}`);
      });
      if (!isInside(root, parentReal))
        throw new GitWorkspaceError(`path escapes workspace: ${path}`);
      try {
        const details = await lstat(target);
        if (details.isSymbolicLink())
          throw new GitWorkspaceError(`symlink path is not allowed: ${path}`);
        if (!details.isFile()) throw new GitWorkspaceError(`path is not a regular file: ${path}`);
        if (details.size > MAX_FILE_BYTES) {
          throw new GitWorkspaceError(`file exceeds the ${MAX_FILE_BYTES}-byte limit: ${path}`);
        }
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
    }
  }

  async stagePaths(workspace: string, paths: readonly string[]): Promise<void> {
    await this.validatePaths(workspace, paths);
    const root = await this.repositoryRoot(workspace);
    if (paths.length === 0) return;
    await this.git(root, ['add', '--', ...paths]);
  }

  async inspectStagedTree(workspace: string): Promise<{
    tree: string;
    fingerprint: GuidedExecutionGitState;
  }> {
    const root = await this.repositoryRoot(workspace);
    const tree = await this.git(root, ['write-tree']);
    return { tree, fingerprint: await this.inspect(root) };
  }

  async commitPhase(workspace: string, intent: GuidedExecutionCommitIntent): Promise<string> {
    const root = await this.repositoryRoot(workspace);
    const staged = await this.inspectStagedTree(root);
    if (intent.tree && staged.tree !== intent.tree) {
      throw new GitWorkspaceError('staged tree differs from commit intent');
    }
    const message = `binaflow: ${intent.phaseId}\n\nBinaflow-Checkpoint: ${intent.runId}/${intent.phaseId}/${intent.token}`;
    await this.git(root, ['commit', '-m', message]);
    return (await this.git(root, ['rev-parse', 'HEAD'])).trim();
  }

  async inspectCommit(workspace: string, commitSha: string): Promise<GuidedCommitInspection> {
    const root = await this.repositoryRoot(workspace);
    const sha = await this.git(root, ['rev-parse', '--verify', `${commitSha}^{commit}`]);
    const parent = await this.git(root, ['rev-parse', '--verify', `${sha}^`]);
    const tree = await this.git(root, ['rev-parse', `${sha}^{tree}`]);
    const branch = await this.gitOptional(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
    const message = await this.git(root, ['show', '-s', '--format=%B', '--no-ext-diff', sha]);
    const trailer = message.match(/^Binaflow-Checkpoint:\s*(\S+)\s*$/m)?.[1];
    return {
      sha,
      parent,
      tree,
      branch,
      ...(trailer ? { trailer } : {}),
      fingerprint: await this.inspect(root),
    };
  }

  async reconcileCommitIntent(
    workspace: string,
    intent: GuidedExecutionCommitIntent,
  ): Promise<{ commitSha: string | null; noChanges: boolean }> {
    const state = await this.inspect(workspace);
    if (state.head === intent.parent) {
      if (state.changes.length === 0) return { commitSha: null, noChanges: true };
      const staged = await this.inspectStagedTree(workspace);
      if (intent.tree && staged.tree !== intent.tree) {
        throw new GitWorkspaceError('workspace differs from incomplete commit intent');
      }
      return { commitSha: await this.commitPhase(workspace, intent), noChanges: false };
    }
    const commit = await this.inspectCommit(workspace, state.head);
    const expectedTrailer = `${intent.runId}/${intent.phaseId}/${intent.token}`;
    if (
      commit.parent !== intent.parent ||
      (intent.tree !== undefined && commit.tree !== intent.tree) ||
      commit.trailer !== expectedTrailer
    ) {
      throw new GitWorkspaceError('HEAD does not match the incomplete commit intent');
    }
    return { commitSha: commit.sha, noChanges: false };
  }

  private async repositoryRoot(workspace: string): Promise<string> {
    const root = await this.git(workspace, ['rev-parse', '--show-toplevel']);
    const canonical = await realpath(root);
    const requested = await realpath(resolve(workspace));
    if (canonical !== requested && !isInside(canonical, requested)) {
      throw new GitWorkspaceError('workspace is not inside the Git repository root');
    }
    return canonical;
  }

  private async gitDirectory(workspace: string): Promise<string> {
    const gitDir = await this.git(workspace, ['rev-parse', '--git-dir']);
    return resolve(workspace, gitDir);
  }

  private async changes(root: string): Promise<GuidedExecutionGitState['changes']> {
    const output = await this.git(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    const records = output.split('\0');
    const changes: GuidedExecutionGitState['changes'] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) continue;
      const status = record.slice(0, 2);
      const firstPath = record.slice(3);
      const paths =
        status.includes('R') || status.includes('C')
          ? [firstPath, records[++index] ?? '']
          : [firstPath];
      for (const path of paths) {
        if (!path) continue;
        changes.push({
          path,
          status,
          mode: await fileMode(root, path),
          contentHash: await fileHash(root, path),
        });
      }
    }
    if (changes.length > MAX_GIT_PATHS) {
      throw new GitWorkspaceError(`Git path limit exceeded: maximum is ${MAX_GIT_PATHS}`);
    }
    return changes.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async git(cwd: string, args: readonly string[]): Promise<string> {
    try {
      const result = await execFileAsync('git', [...args], {
        cwd,
        shell: false,
        timeout: this.timeoutMs,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      });
      return String(result.stdout).trimEnd();
    } catch (error) {
      const details = error as { stderr?: string; message?: string };
      throw new GitWorkspaceError(
        `git ${args.join(' ')} failed: ${(details.stderr ?? details.message ?? String(error)).trim()}`,
      );
    }
  }

  private async gitOptional(cwd: string, args: readonly string[]): Promise<string> {
    try {
      return await this.git(cwd, args);
    } catch {
      return '';
    }
  }
}

async function fileHash(root: string, path: string): Promise<string | null> {
  try {
    const result = await execFileAsync('git', ['hash-object', '--', path], {
      cwd: root,
      shell: false,
      timeout: 30_000,
      maxBuffer: 1024,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return String(result.stdout).trim() || null;
  } catch {
    return null;
  }
}

async function fileMode(root: string, path: string): Promise<string> {
  try {
    const details = await lstat(join(root, path));
    if (details.isSymbolicLink()) return '120000';
    if (!details.isFile()) return '000000';
    return (details.mode & 0o111) !== 0 ? '100755' : '100644';
  } catch {
    return '000000';
  }
}

async function assertNoSymlink(root: string, directory: string): Promise<void> {
  let current = directory;
  while (isInside(root, current) && current !== root) {
    const details = await lstat(current);
    if (details.isSymbolicLink())
      throw new GitWorkspaceError(`symlink directory is not allowed: ${current}`);
    current = dirname(current);
  }
}

function validateRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0')) {
    throw new GitWorkspaceError(`invalid relative path: ${path}`);
  }
  if (path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new GitWorkspaceError(`invalid relative path: ${path}`);
  }
  if (/[\*\?\[\]]/.test(path)) throw new GitWorkspaceError(`path globs are not allowed: ${path}`);
}

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
