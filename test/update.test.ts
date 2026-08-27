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
  downloadAssetToFile,
  downloadChecksumAsset,
  findLatestRelease,
  MAX_DOWNLOAD_BYTES,
  parseChecksum,
  type FetchLike,
} from '../src/update/release-client.js';
import { INSTALL_ROOT_ENV, managedInstallRoot } from '../src/update/paths.js';

const temporaryDirectories: string[] = [];
const symlinkIt = process.platform === 'win32' ? it.skip : it;

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

  it('streams an archive to disk and verifies its streamed checksum', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-update-'));
    temporaryDirectories.push(directory);
    const archivePath = join(directory, 'archive.tar.gz');
    const archive = new TextEncoder().encode('archive contents');
    const digest = createHash('sha256').update(archive).digest('hex');
    const checksumBody = new TextEncoder().encode(`${digest}  archive.tar.gz\n`);
    const fetcher: FetchLike = async (input) =>
      String(input).endsWith('.sha256')
        ? streamedResponse([checksumBody])
        : streamedResponse([archive.slice(0, 7), archive.slice(7)]);

    const actual = await downloadAssetToFile(
      {
        name: 'archive.tar.gz',
        url: 'https://github.com/archive.tar.gz',
        size: archive.byteLength,
      },
      archivePath,
      fetcher,
    );
    const checksum = parseChecksum(
      new TextDecoder().decode(
        await downloadChecksumAsset(
          {
            name: 'archive.tar.gz.sha256',
            url: 'https://github.com/archive.tar.gz.sha256',
            size: checksumBody.byteLength,
          },
          fetcher,
        ),
      ),
      'archive.tar.gz',
    );

    expect(readFileSync(archivePath)).toEqual(Buffer.from(archive));
    expect(actual).toBe(checksum);
  });

  it('accepts a response exactly at the archive byte limit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-update-'));
    temporaryDirectories.push(directory);
    const archivePath = join(directory, 'archive.tar.gz');
    const fetcher: FetchLike = async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-length': String(MAX_DOWNLOAD_BYTES) },
      });

    await expect(
      downloadAssetToFile(
        {
          name: 'archive.tar.gz',
          url: 'https://github.com/archive.tar.gz',
          size: MAX_DOWNLOAD_BYTES,
        },
        archivePath,
        fetcher,
      ),
    ).resolves.toHaveLength(64);
  });

  it('rejects an archive stream as soon as it exceeds the byte limit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-update-'));
    temporaryDirectories.push(directory);
    const archivePath = join(directory, 'archive.tar.gz');
    const fetcher: FetchLike = async () =>
      responseWithReader(async () => ({
        done: false,
        value: { byteLength: MAX_DOWNLOAD_BYTES + 1 } as Uint8Array,
      }));

    await expect(
      downloadAssetToFile(
        { name: 'archive.tar.gz', url: 'https://github.com/archive.tar.gz', size: 1 },
        archivePath,
        fetcher,
      ),
    ).rejects.toThrow('exceeds the size limit');
  });

  it('bounds streamed checksum responses', async () => {
    const fetcher: FetchLike = async () =>
      responseWithReader(async () => ({
        done: false,
        value: { byteLength: 64 * 1024 + 1 } as Uint8Array,
      }));

    await expect(
      downloadChecksumAsset(
        { name: 'archive.tar.gz.sha256', url: 'https://github.com/archive.tar.gz.sha256', size: 1 },
        fetcher,
      ),
    ).rejects.toThrow('exceeds the size limit');
  });

  it('rejects a checksum mismatch before validating the archive', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-update-'));
    temporaryDirectories.push(directory);
    const versions = join(directory, 'versions');
    const archive = new TextEncoder().encode('not a tar archive');
    const archiveName = 'binaflow-linux-x64-0.1.0-preview.1.tar.gz';
    const digest = createHash('sha256').update(archive).digest('hex');
    const mismatch = `${digest.slice(0, -1)}${digest.endsWith('0') ? '1' : '0'}`;
    const savedRoot = process.env[INSTALL_ROOT_ENV];
    let releaseLookups = 0;
    mkdirSync(versions, { recursive: true });
    process.env[INSTALL_ROOT_ENV] = directory;
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/releases?')) {
        releaseLookups += 1;
        return new Response(JSON.stringify([release('0.1.0-preview.1', true)]));
      }
      if (url.endsWith('.sha256')) return new Response(`${mismatch}  ${archiveName}\n`);
      return new Response(archive, { status: 200 });
    };

    try {
      await expect(installUpdate('preview', fetcher)).rejects.toThrow(
        'SHA-256 verification failed',
      );
      expect(releaseLookups).toBe(1);
    } finally {
      if (savedRoot === undefined) delete process.env[INSTALL_ROOT_ENV];
      else process.env[INSTALL_ROOT_ENV] = savedRoot;
    }
  });

  it('refuses self-update when the CLI was not started by the managed launcher', () => {
    const savedRoot = process.env[INSTALL_ROOT_ENV];
    delete process.env[INSTALL_ROOT_ENV];
    expect(() => managedInstallRoot()).toThrow('bundle installed by install.sh');
    if (savedRoot === undefined) delete process.env[INSTALL_ROOT_ENV];
    else process.env[INSTALL_ROOT_ENV] = savedRoot;
  });

  symlinkIt('leaves the active version untouched when an update archive is invalid', async () => {
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

  symlinkIt('rolls back only the installation pointers and respects the update lock', async () => {
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

function streamedResponse(chunks: Uint8Array[]): Response {
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    }),
    { status: 200 },
  );
}

function responseWithReader(read: () => Promise<{ done: boolean; value?: Uint8Array }>): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: { getReader: () => ({ read }) },
  } as unknown as Response;
}
