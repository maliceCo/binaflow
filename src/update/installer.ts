import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { VERSION } from '../version.js';
import {
  compareVersions,
  downloadAssetToFile,
  downloadChecksumAsset,
  findLatestRelease,
  parseChecksum,
  type FetchLike,
  type ReleaseChannel,
  type ReleaseInfo,
} from './release-client.js';
import { installPaths, managedInstallRoot, type InstallPaths } from './paths.js';
import { parseManifest, payloadSha256 } from './manifest.js';

const execFileAsync = promisify(execFile);
const ARCHIVE_COMMAND_TIMEOUT_MS = 60_000;
const SMOKE_TEST_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;

export async function checkForUpdate(
  channel: ReleaseChannel,
  fetcher?: FetchLike,
): Promise<{ current: string; release: ReleaseInfo; available: boolean }> {
  const release = await findLatestRelease(channel, fetcher);
  return { current: VERSION, release, available: compareVersions(release.version, VERSION) > 0 };
}

export async function installUpdate(
  channel: ReleaseChannel,
  fetcher?: FetchLike,
): Promise<ReleaseInfo> {
  const paths = installPaths(managedInstallRoot());
  return withInstallLock(paths, async () => {
    const check = await checkForUpdate(channel, fetcher);
    if (compareVersions(check.release.version, VERSION) < 0) {
      throw new Error(
        `Refusing to downgrade Binaflow from ${VERSION} to ${check.release.version}; use rollback instead`,
      );
    }
    if (!check.available)
      throw new Error(`Binaflow ${VERSION} is already at the newest ${channel} release`);
    await stageAndActivate(paths, check.release, fetcher);
    return check.release;
  });
}

async function stageAndActivate(
  paths: InstallPaths,
  release: ReleaseInfo,
  fetcher?: FetchLike,
): Promise<void> {
  await validateInstallLayout(paths);
  await mkdir(paths.versions, { recursive: true, mode: 0o755 });
  const stagingParent = await mkdtemp(join(paths.root, '.staging-'));
  const archivePath = join(stagingParent, release.asset.name);
  try {
    const actual = await downloadAssetToFile(release.asset, archivePath, fetcher);
    const checksum = parseChecksum(
      new TextDecoder().decode(await downloadChecksumAsset(release.checksumAsset, fetcher)),
      release.asset.name,
    );
    if (actual !== checksum)
      throw new Error(`SHA-256 verification failed for ${release.asset.name}`);
    await validateArchive(archivePath);
    await execFileAsync(
      'tar',
      ['-xzf', archivePath, '--no-same-owner', '--no-same-permissions', '-C', stagingParent],
      { timeout: ARCHIVE_COMMAND_TIMEOUT_MS, maxBuffer: MAX_COMMAND_OUTPUT_BYTES },
    );
    const bundleRoot = join(stagingParent, 'binaflow');
    const manifest = parseManifest(
      JSON.parse(await readFile(join(bundleRoot, 'manifest.json'), 'utf8')),
    );
    if (manifest.version !== release.version)
      throw new Error('Bundle manifest version does not match the release asset');
    if ((await payloadSha256(bundleRoot)) !== manifest.payloadSha256)
      throw new Error('Bundle payload checksum is invalid');
    await smokeTest(bundleRoot);
    const target = join(paths.versions, release.version);
    assertInstallTarget(paths, relative(paths.root, target));
    await rm(target, { recursive: true, force: true });
    await rename(bundleRoot, target);
    await activate(
      paths,
      relative(paths.root, target),
      await readlink(paths.current).catch(() => undefined),
    );
  } finally {
    await rm(stagingParent, { recursive: true, force: true });
  }
}

export async function rollbackUpdate(): Promise<string> {
  const paths = installPaths(managedInstallRoot());
  return withInstallLock(paths, async () => {
    await validateInstallLayout(paths);
    const currentTarget = await readlink(paths.current).catch(() => undefined);
    const previousTarget = await readlink(paths.previous).catch(() => undefined);
    if (!previousTarget) throw new Error('No previous Binaflow version is available for rollback');
    await activate(paths, previousTarget, currentTarget);
    return basename(previousTarget);
  });
}

async function activate(
  paths: InstallPaths,
  target: string,
  oldTarget: string | undefined,
): Promise<void> {
  assertInstallTarget(paths, target);
  if (oldTarget) assertInstallTarget(paths, oldTarget);
  await mkdir(paths.root, { recursive: true, mode: 0o755 });
  if (oldTarget && oldTarget !== target) await replaceLink(paths.previous, oldTarget);
  await replaceLink(paths.current, target);
}

async function replaceLink(path: string, target: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await rm(temporary, { force: true, recursive: true });
  await symlink(target, temporary);
  await rename(temporary, path);
}

async function validateArchive(archivePath: string): Promise<void> {
  const { stdout: names } = await execFileAsync('tar', ['-tzf', archivePath], {
    timeout: ARCHIVE_COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  const memberNames = names.split('\n').filter(Boolean);
  for (const name of memberNames) {
    const normalized = name.replaceAll('\\', '/');
    if (normalized !== 'binaflow' && !normalized.startsWith('binaflow/'))
      throw new Error(`Archive entry is outside the bundle root: ${name}`);
    if (normalized.startsWith('/') || normalized.split('/').includes('..'))
      throw new Error(`Unsafe archive path: ${name}`);
  }
  const { stdout: listing } = await execFileAsync('tar', ['-tvzf', archivePath], {
    timeout: ARCHIVE_COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  for (const line of listing.split('\n').filter(Boolean)) {
    const kind = line[0];
    if (kind !== '-' && kind !== 'd' && kind !== 'l' && kind !== 'h')
      throw new Error(`Unsupported archive entry: ${line}`);
    if (kind === 'l' || kind === 'h') {
      const separator = kind === 'l' ? ' -> ' : ' link to ';
      const separatorIndex = line.indexOf(separator);
      const memberName = memberNames
        .filter((name) => line.includes(` ${name}${separator}`))
        .sort((a, b) => b.length - a.length)[0];
      if (separatorIndex < 0 || !memberName) throw new Error(`Malformed archive link: ${line}`);
      const target = line.slice(separatorIndex + separator.length);
      if (posix.isAbsolute(target)) throw new Error(`Unsafe archive link: ${line}`);
      const normalizedTarget = target.startsWith('binaflow/')
        ? posix.normalize(target)
        : posix.normalize(posix.join(posix.dirname(memberName), target));
      if (normalizedTarget !== 'binaflow' && !normalizedTarget.startsWith('binaflow/'))
        throw new Error(`Unsafe archive link: ${line}`);
    }
  }
}

async function smokeTest(bundleRoot: string): Promise<void> {
  const node = join(bundleRoot, 'runtime', 'bin', 'node');
  const entry = join(bundleRoot, 'app', 'dist', 'src', 'cli', 'index.js');
  await execFileAsync(node, [entry, '--version'], {
    cwd: bundleRoot,
    timeout: SMOKE_TEST_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  await execFileAsync(node, [entry, '--help'], {
    cwd: bundleRoot,
    timeout: SMOKE_TEST_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  await execFileAsync(node, ['-e', "import('better-sqlite3').then(() => process.exit(0))"], {
    cwd: join(bundleRoot, 'app'),
    timeout: SMOKE_TEST_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
}

async function withInstallLock<T>(paths: InstallPaths, action: () => Promise<T>): Promise<T> {
  await mkdir(paths.root, { recursive: true, mode: 0o755 });
  await validateInstallLayout(paths);
  let ownerToken: string | undefined;
  while (!ownerToken) {
    let createdLock = false;
    try {
      await mkdir(paths.lock, { mode: 0o700 });
      createdLock = true;
      const token = randomUUID();
      await writeFile(join(paths.lock, 'owner.json'), JSON.stringify({ pid: process.pid, token }), {
        encoding: 'utf8',
        flag: 'wx',
      });
      ownerToken = token;
    } catch (error) {
      if (createdLock) {
        await rm(paths.lock, { recursive: true, force: true });
        throw error;
      }
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      const staleToken = await staleLockOwner(paths.lock);
      if (!staleToken) {
        throw new Error('Another Binaflow update is already in progress');
      }
      const quarantine = `${paths.lock}.stale-${randomUUID()}`;
      try {
        await rename(paths.lock, quarantine);
      } catch (renameError) {
        if (
          renameError instanceof Error &&
          'code' in renameError &&
          renameError.code === 'ENOENT'
        ) {
          continue;
        }
        throw renameError;
      }
      const quarantinedToken = await lockToken(quarantine);
      if (quarantinedToken !== staleToken) {
        await restoreQuarantinedLock(quarantine, paths.lock);
        continue;
      }
      await rm(quarantine, { recursive: true, force: true });
    }
  }
  try {
    return await action();
  } finally {
    await removeOwnedLock(paths.lock, ownerToken);
  }
}

async function removeOwnedLock(lockPath: string, token: string): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as {
      token?: unknown;
    };
    if (owner.token === token) await rm(lockPath, { recursive: true, force: true });
  } catch {
    // The lock may already have been quarantined or removed by its owner.
  }
}

async function staleLockOwner(lockPath: string): Promise<string | undefined> {
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (
    typeof owner !== 'object' ||
    owner === null ||
    !('pid' in owner) ||
    typeof owner.pid !== 'number' ||
    !Number.isInteger(owner.pid) ||
    owner.pid < 1
  ) {
    return undefined;
  }
  const token = await lockToken(lockPath);
  if (!token) return undefined;
  try {
    process.kill(owner.pid, 0);
    return undefined;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH' ? token : undefined;
  }
}

async function lockToken(lockPath: string): Promise<string | undefined> {
  try {
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as {
      token?: unknown;
    };
    return typeof owner.token === 'string' ? owner.token : undefined;
  } catch {
    return undefined;
  }
}

async function restoreQuarantinedLock(quarantine: string, lockPath: string): Promise<void> {
  try {
    await readFile(join(lockPath, 'owner.json'), 'utf8');
    return;
  } catch {
    try {
      await rename(quarantine, lockPath);
    } catch {
      // A competing owner may have recreated the lock; never remove it.
    }
  }
}

async function validateInstallLayout(paths: InstallPaths): Promise<void> {
  const canonicalRoot = await realpath(paths.root);
  for (const [name, path] of [
    ['versions', paths.versions],
    ['current', paths.current],
    ['previous', paths.previous],
  ] as const) {
    if (resolvePath(path) !== resolvePath(join(paths.root, name))) {
      throw new Error(`Invalid managed install path for ${name}`);
    }
  }
  const versionsInfo = await lstat(paths.versions).catch(() => undefined);
  if (versionsInfo && (!versionsInfo.isDirectory() || versionsInfo.isSymbolicLink())) {
    throw new Error('Managed versions path must be a real directory');
  }
  for (const link of [paths.current, paths.previous]) {
    const info = await lstat(link).catch(() => undefined);
    if (!info) continue;
    if (!info.isSymbolicLink()) throw new Error(`Managed link is not a symbolic link: ${link}`);
    const target = await readlink(link);
    assertInstallTarget({ ...paths, root: canonicalRoot }, target);
  }
}

function assertInstallTarget(paths: InstallPaths, target: string): void {
  const root = resolvePath(paths.root);
  const versions = resolvePath(join(root, 'versions'));
  if (isAbsolute(target)) throw new Error(`Managed install target must be relative: ${target}`);
  const targetPath = resolvePath(resolve(root, target));
  if (targetPath === versions || !isWithin(versions, targetPath)) {
    throw new Error(`Managed install target is outside versions: ${target}`);
  }
}

function resolvePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(root: string, path: string): boolean {
  const pathRelativeToRoot = relative(root, path);
  const normalizedRelative = pathRelativeToRoot.replaceAll('\\', '/');
  return (
    pathRelativeToRoot !== '' &&
    pathRelativeToRoot !== '..' &&
    !normalizedRelative.startsWith('../') &&
    !isAbsolute(pathRelativeToRoot)
  );
}
