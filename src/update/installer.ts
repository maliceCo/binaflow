import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, join, posix, relative } from 'node:path';
import { VERSION } from '../version.js';
import {
  compareVersions,
  downloadAsset,
  findLatestRelease,
  parseChecksum,
  type FetchLike,
  type ReleaseChannel,
  type ReleaseInfo,
} from './release-client.js';
import { installPaths, managedInstallRoot, type InstallPaths } from './paths.js';
import { parseManifest, payloadSha256 } from './manifest.js';

const execFileAsync = promisify(execFile);

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
    const archive = await downloadAsset(check.release.asset, fetcher);
    const checksum = parseChecksum(
      new TextDecoder().decode(await downloadAsset(check.release.checksumAsset, fetcher)),
      check.release.asset.name,
    );
    const actual = createHash('sha256').update(archive).digest('hex');
    if (actual !== checksum)
      throw new Error(`SHA-256 verification failed for ${check.release.asset.name}`);
    await stageAndActivate(paths, check.release, archive);
    return check.release;
  });
}

export async function rollbackUpdate(): Promise<string> {
  const paths = installPaths(managedInstallRoot());
  return withInstallLock(paths, async () => {
    const currentTarget = await readlink(paths.current).catch(() => undefined);
    const previousTarget = await readlink(paths.previous).catch(() => undefined);
    if (!previousTarget) throw new Error('No previous Binaflow version is available for rollback');
    await activate(paths, previousTarget, currentTarget);
    return basename(previousTarget);
  });
}

async function stageAndActivate(
  paths: InstallPaths,
  release: ReleaseInfo,
  archive: Uint8Array,
): Promise<void> {
  await mkdir(paths.versions, { recursive: true, mode: 0o755 });
  const stagingParent = await mkdtemp(join(paths.root, '.staging-'));
  const archivePath = join(stagingParent, release.asset.name);
  try {
    await writeFile(archivePath, archive, { mode: 0o600 });
    await validateArchive(archivePath);
    await execFileAsync('tar', [
      '-xzf',
      archivePath,
      '--no-same-owner',
      '--no-same-permissions',
      '-C',
      stagingParent,
    ]);
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

async function activate(
  paths: InstallPaths,
  target: string,
  oldTarget: string | undefined,
): Promise<void> {
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
  const { stdout: names } = await execFileAsync('tar', ['-tzf', archivePath]);
  const memberNames = names.split('\n').filter(Boolean);
  for (const name of memberNames) {
    const normalized = name.replaceAll('\\', '/');
    if (normalized !== 'binaflow' && !normalized.startsWith('binaflow/'))
      throw new Error(`Archive entry is outside the bundle root: ${name}`);
    if (normalized.startsWith('/') || normalized.split('/').includes('..'))
      throw new Error(`Unsafe archive path: ${name}`);
  }
  const { stdout: listing } = await execFileAsync('tar', ['-tvzf', archivePath]);
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
  await execFileAsync(node, [entry, '--version'], { cwd: bundleRoot });
  await execFileAsync(node, [entry, '--help'], { cwd: bundleRoot });
  await execFileAsync(node, ['-e', "import('better-sqlite3').then(() => process.exit(0))"], {
    cwd: join(bundleRoot, 'app'),
  });
}

async function withInstallLock<T>(paths: InstallPaths, action: () => Promise<T>): Promise<T> {
  await mkdir(paths.root, { recursive: true, mode: 0o755 });
  try {
    await mkdir(paths.lock, { mode: 0o700 });
  } catch {
    throw new Error('Another Binaflow update is already in progress');
  }
  try {
    return await action();
  } finally {
    await rm(paths.lock, { recursive: true, force: true });
  }
}
