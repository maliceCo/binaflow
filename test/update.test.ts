import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { payloadSha256, parseManifest } from '../src/update/manifest.js';
import { installUpdate, rollbackUpdate } from '../src/update/installer.js';
import {
  compareVersions,
  findLatestRelease,
  parseChecksum,
  type FetchLike,
} from '../src/update/release-client.js';
import { INSTALL_ROOT_ENV, managedInstallRoot } from '../src/update/paths.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('release updates', () => {
  it('selects the newest release in the requested channel and requires exact assets', async () => {
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/releases?')) {
        return new Response(
          JSON.stringify([
            release('0.1.0-preview.0', true),
            release('0.1.0-preview.1', true),
            release('0.1.0', false),
          ]),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    };

    await expect(findLatestRelease('preview', fetcher)).resolves.toMatchObject({
      version: '0.1.0-preview.1',
    });
    await expect(findLatestRelease('stable', fetcher)).resolves.toMatchObject({ version: '0.1.0' });

    const missingAssetFetcher: FetchLike = async () =>
      new Response(JSON.stringify([release('0.1.0-preview.1', true, false)]), { status: 200 });
    await expect(findLatestRelease('preview', missingAssetFetcher)).rejects.toThrow(
      'No usable preview',
    );
  });

  it('validates checksums, versions, and bundle manifests', async () => {
    expect(parseChecksum('deadbeef  file\n' + 'a'.repeat(64) + '  file', 'file')).toBe(
      'a'.repeat(64),
    );
    expect(() => parseChecksum(`${'a'.repeat(64)}  other-file`, 'file')).toThrow('SHA-256');
    expect(() => parseChecksum('not a digest', 'file')).toThrow('SHA-256');
    expect(compareVersions('0.1.0-preview.10', '0.1.0-preview.2')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0-preview.9')).toBeGreaterThan(0);
    expect(() => parseManifest({ format: 'wrong' })).toThrow('field version');

    const directory = mkdtempSync(join(tmpdir(), 'binaflow-update-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'payload.txt'), 'payload');
    const digest = await payloadSha256(directory);
    expect(
      parseManifest({
        format: 'binaflow-linux-bundle-v1',
        version: '0.1.0-preview.0',
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
        nodeVersion: 'v22.23.2',
        checksumAlgorithm: 'sha256',
        payloadSha256: digest,
      }).payloadSha256,
    ).toBe(digest);
  });

  it('refuses self-update when the CLI was not started by the managed launcher', () => {
    const savedRoot = process.env[INSTALL_ROOT_ENV];
    delete process.env[INSTALL_ROOT_ENV];
    expect(() => managedInstallRoot()).toThrow('bundle installed by install.sh');
    if (savedRoot === undefined) delete process.env[INSTALL_ROOT_ENV];
    else process.env[INSTALL_ROOT_ENV] = savedRoot;
  });

  it('leaves the active version untouched when an update archive is invalid', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-update-'));
    temporaryDirectories.push(directory);
    const versions = join(directory, 'versions');
    const currentTarget = join(versions, '0.1.0-preview.0');
    const archive = new TextEncoder().encode('not a tar archive');
    const digest = createHash('sha256').update(archive).digest('hex');
    const currentRoot = process.env[INSTALL_ROOT_ENV];
    mkdirSync(versions, { recursive: true });
    mkdirSync(currentTarget, { recursive: true });
    symlinkSync('versions/0.1.0-preview.0', join(directory, 'current'));
    process.env[INSTALL_ROOT_ENV] = directory;
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/releases?'))
        return new Response(JSON.stringify([release('0.1.0-preview.1', true)]));
      if (url.endsWith('.sha256')) return new Response(`${digest}  archive.tar.gz\n`);
      return new Response(archive, { status: 200 });
    };

    await expect(installUpdate('preview', fetcher)).rejects.toThrow();
    expect(readlinkSync(join(directory, 'current'))).toBe('versions/0.1.0-preview.0');
    if (currentRoot === undefined) delete process.env[INSTALL_ROOT_ENV];
    else process.env[INSTALL_ROOT_ENV] = currentRoot;
  });

  it('rolls back only the installation pointers and respects the update lock', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-update-'));
    temporaryDirectories.push(directory);
    const versions = join(directory, 'versions');
    mkdirSync(join(versions, '0.1.0-preview.0'), { recursive: true });
    mkdirSync(join(versions, '0.1.0-preview.1'), { recursive: true });
    symlinkSync('versions/0.1.0-preview.1', join(directory, 'current'));
    symlinkSync('versions/0.1.0-preview.0', join(directory, 'previous'));
    const dataPath = join(directory, 'runs.db');
    writeFileSync(dataPath, 'unchanged');
    const savedRoot = process.env[INSTALL_ROOT_ENV];
    process.env[INSTALL_ROOT_ENV] = directory;

    await expect(rollbackUpdate()).resolves.toBe('0.1.0-preview.0');
    expect(readlinkSync(join(directory, 'current'))).toBe('versions/0.1.0-preview.0');
    expect(readlinkSync(join(directory, 'previous'))).toBe('versions/0.1.0-preview.1');
    expect(readFileSync(dataPath, 'utf8')).toBe('unchanged');

    mkdirSync(join(directory, '.update.lock'));
    await expect(rollbackUpdate()).rejects.toThrow('already in progress');
    if (savedRoot === undefined) delete process.env[INSTALL_ROOT_ENV];
    else process.env[INSTALL_ROOT_ENV] = savedRoot;
  });
});

function release(
  version: string,
  prerelease: boolean,
  includeAssets = true,
): Record<string, unknown> {
  const archive = `binaflow-linux-x64-${version}.tar.gz`;
  return {
    tag_name: `v${version}`,
    prerelease,
    draft: false,
    assets: includeAssets
      ? [
          {
            name: archive,
            browser_download_url: `https://github.com/maliceCo/binaflow/releases/${archive}`,
            size: 1,
          },
          {
            name: `${archive}.sha256`,
            browser_download_url: `https://github.com/maliceCo/binaflow/releases/${archive}.sha256`,
            size: 1,
          },
        ]
      : [],
  };
}
