import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  PortabilityContractError,
  type PortabilityBlocker,
  type TransferFileHash,
  type TransferManifest,
} from '../application/portability.js';
import type { PortabilityGit } from '../application/ports.js';
import { LocalGitWorkspace } from '../workspace/git-workspace.js';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_TRACKED_FILES = 100_000;

export const gitTransfer: PortabilityGit = {
  previewRepositoryTransfer,
  createRepositoryBundle,
  inspectRepositoryBundle,
  assertImportWorkspace,
};

export interface RepositoryTransferPreview {
  workspace: string;
  branch: string;
  ref: string;
  head: string;
  fingerprint: string;
  blockers: PortabilityBlocker[];
}

export class GitTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitTransferError';
  }
}

export async function previewRepositoryTransfer(
  workspace: string,
): Promise<RepositoryTransferPreview> {
  const git = new LocalGitWorkspace();
  try {
    const state = await git.preflight(workspace);
    const root = state.workspace;
    const lfs = await trackedLfsPaths(root);
    const gitlinks = await trackedGitlinks(root);
    const blockers: PortabilityBlocker[] = [];
    if (lfs.length > 0) {
      blockers.push({
        code: 'invalid-repository',
        detail: 'tracked Git LFS files are not supported',
      });
    }
    if (gitlinks.length > 0) {
      blockers.push({
        code: 'invalid-repository',
        detail: 'Git submodule entries are not supported',
      });
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(state)).digest('hex');
    return {
      workspace: root,
      branch: state.branch,
      ref: `refs/heads/${state.branch}`,
      head: state.head,
      fingerprint,
      blockers,
    };
  } catch (error) {
    return {
      workspace: resolve(workspace),
      branch: '',
      ref: '',
      head: '',
      fingerprint: '',
      blockers: [
        {
          code: 'invalid-repository',
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export async function createRepositoryBundle(
  workspace: string,
  destination: string,
  ref?: string,
): Promise<TransferFileHash> {
  const preview = await previewRepositoryTransfer(workspace);
  if (preview.blockers.length > 0) {
    throw new PortabilityContractError(
      'invalid-input',
      preview.blockers.map((item) => item.detail).join('; '),
    );
  }
  const output = resolve(destination);
  await assertOutputAvailable(output);
  const selectedRef = ref ?? preview.ref;
  if (selectedRef !== preview.ref) {
    throw new GitTransferError('Only the active branch ref can be exported');
  }
  try {
    await runGit(preview.workspace, ['bundle', 'create', output, selectedRef]);
    const inspected = await inspectRepositoryBundle(output);
    if (inspected.ref !== selectedRef || inspected.head !== preview.head) {
      throw new GitTransferError('Created Git bundle does not match the active branch HEAD');
    }
    return { path: output, sha256: inspected.sha256, sizeBytes: inspected.sizeBytes };
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

export async function inspectRepositoryBundle(
  bundlePath: string,
): Promise<{ ref: string; head: string; sha256: string; sizeBytes: number }> {
  const path = resolve(bundlePath);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1) {
    throw new GitTransferError('Repository bundle must be a regular, unlinked file');
  }
  const verificationRepository = await mkdtemp(join(tmpdir(), 'binaflow-bundle-verify-'));
  try {
    await runGit(verificationRepository, ['init', '--bare']);
    const verification = await runGit(verificationRepository, ['bundle', 'verify', path]);
    if (!verification.stdout && !verification.stderr) {
      throw new GitTransferError('Git bundle verification returned no result');
    }
  } finally {
    await rm(verificationRepository, { recursive: true, force: true });
  }
  const heads = await runGit(dirname(path), ['bundle', 'list-heads', path]);
  const records = heads.stdout.trim().split('\n').filter(Boolean);
  if (records.length !== 1)
    throw new GitTransferError('Git bundle must advertise exactly one branch ref');
  const [head, ref] = records[0]?.trim().split(/\s+/, 2) ?? [];
  if (!head || !ref || !/^[0-9a-f]{40}$/.test(head) || !/^refs\/heads\//.test(ref)) {
    throw new GitTransferError('Git bundle advertised ref is invalid');
  }
  const hash = await hashFile(path);
  return { ref, head, sha256: hash.sha256, sizeBytes: hash.sizeBytes };
}

export async function assertImportWorkspace(
  workspace: string,
  manifest: TransferManifest,
): Promise<void> {
  const preview = await previewRepositoryTransfer(workspace);
  if (preview.blockers.length > 0) {
    throw new PortabilityContractError(
      'invalid-input',
      preview.blockers.map((item) => item.detail).join('; '),
    );
  }
  if (
    preview.branch !== manifest.git.branch ||
    preview.ref !== manifest.git.ref ||
    preview.head !== manifest.git.head
  ) {
    throw new GitTransferError('Repository branch or HEAD does not match the transfer manifest');
  }
}

async function trackedGitlinks(root: string): Promise<string[]> {
  const output = await runGit(root, ['ls-files', '--stage', '-z']);
  const entries = output.stdout.split('\0').filter(Boolean);
  if (entries.length > MAX_TRACKED_FILES) throw new GitTransferError('Tracked file limit exceeded');
  return entries
    .filter((entry) => entry.startsWith('160000 '))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1));
}

async function trackedLfsPaths(root: string): Promise<string[]> {
  const output = await runGit(root, ['ls-files', '-z']);
  const paths = output.stdout.split('\0').filter(Boolean);
  if (paths.length > MAX_TRACKED_FILES) throw new GitTransferError('Tracked file limit exceeded');
  const lfs: string[] = [];
  for (const path of paths) {
    const attribute = await runGit(root, ['check-attr', 'filter', '--', path]);
    if (attribute.stdout.trim().endsWith(': lfs')) lfs.push(path);
  }
  return lfs;
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      shell: false,
      timeout: 30_000,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const details = error as { stderr?: string; message?: string };
    throw new GitTransferError(
      `git ${args.join(' ')} failed: ${(details.stderr ?? details.message ?? String(error)).trim()}`,
    );
  }
}

async function hashFile(path: string): Promise<TransferFileHash> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    hash.update(buffer);
  }
  return { path, sha256: hash.digest('hex'), sizeBytes };
}

async function assertOutputAvailable(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new GitTransferError('Git bundle output already exists');
}
