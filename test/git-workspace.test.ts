import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalGitWorkspace } from '../src/workspace/git-workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'binaflow-git-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, shell: false });
  return String(result.stdout).trim();
}

async function repository(): Promise<string> {
  const directory = await temporaryDirectory();
  await git(directory, 'init', '--initial-branch=main');
  await git(directory, 'config', 'user.name', 'Binaflow Test');
  await git(directory, 'config', 'user.email', 'binaflow@example.test');
  await writeFile(join(directory, 'README.md'), 'initial\n');
  await git(directory, 'add', '--', 'README.md');
  await git(directory, 'commit', '-m', 'initial');
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('LocalGitWorkspace', () => {
  it('accepts a clean repository and rejects dirty worktrees', async () => {
    const directory = await repository();
    const workspace = new LocalGitWorkspace();
    const clean = await workspace.preflight(directory);
    expect(clean).toMatchObject({ workspace: directory, branch: 'main', clean: true });

    await mkdir(join(directory, '.binaflow', 'data'), { recursive: true });
    await writeFile(join(directory, '.binaflow', 'data', 'runs.db'), 'runtime data\n');
    await expect(workspace.preflight(directory)).resolves.toMatchObject({ clean: true });

    await writeFile(join(directory, 'untracked.txt'), 'untracked\n');
    await expect(workspace.preflight(directory)).rejects.toThrow('must be clean');
  });

  it('validates workspace-contained regular paths, including paths with spaces', async () => {
    const directory = await repository();
    const workspace = new LocalGitWorkspace();
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'src', 'file with spaces.ts'), 'export {}\n');

    await expect(
      workspace.validatePaths(directory, ['src/file with spaces.ts']),
    ).resolves.toBeUndefined();
    await expect(workspace.validatePaths(directory, ['../outside.ts'])).rejects.toThrow(
      'invalid relative path',
    );
    await expect(workspace.validatePaths(directory, ['src/*.ts'])).rejects.toThrow('globs');

    const outside = await temporaryDirectory();
    await symlink(outside, join(directory, 'linked'));
    await expect(workspace.validatePaths(directory, ['linked/file.ts'])).rejects.toThrow('symlink');

    await rename(join(directory, 'README.md'), join(directory, 'renamed file.md'));
    await workspace.stagePaths(directory, ['README.md', 'renamed file.md']);
    expect((await workspace.inspect(directory)).changes.map((change) => change.path)).toEqual(
      expect.arrayContaining(['README.md', 'renamed file.md']),
    );
  });

  it('stages and commits only the requested paths with an exact checkpoint trailer', async () => {
    const directory = await repository();
    const workspace = new LocalGitWorkspace();
    const parent = (await workspace.inspect(directory)).head;
    await writeFile(join(directory, 'change.txt'), 'changed\n');
    await workspace.stagePaths(directory, ['change.txt']);
    const staged = await workspace.inspectStagedTree(directory);
    const intent = {
      runId: 'guided-request',
      phaseId: 'phase-1',
      token: 'commit-token',
      branch: 'main',
      parent,
      tree: staged.tree,
      fingerprint: staged.fingerprint,
      paths: ['change.txt'],
      message: 'ignored free-form message',
      evidenceArtifactIds: [],
    };

    const commitSha = await workspace.commitPhase(directory, intent);
    const commit = await workspace.inspectCommit(directory, commitSha);
    expect(commit).toMatchObject({
      sha: commitSha,
      parent,
      tree: staged.tree,
      branch: 'main',
      trailer: 'guided-request/phase-1/commit-token',
    });
    expect(commit.fingerprint.clean).toBe(true);
  });

  it('reports no changes and reconciles a commit already created from the intent', async () => {
    const directory = await repository();
    const workspace = new LocalGitWorkspace();
    const parent = (await workspace.inspect(directory)).head;
    const intent = {
      runId: 'guided-request',
      phaseId: 'phase-1',
      token: 'commit-token',
      branch: 'main',
      parent,
      fingerprint: await workspace.inspect(directory),
      paths: [],
      message: 'ignored',
      evidenceArtifactIds: [],
    };
    await expect(workspace.reconcileCommitIntent(directory, intent)).resolves.toEqual({
      commitSha: null,
      noChanges: true,
    });
  });
});
