import { RELEASE_REPOSITORY } from './paths.js';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export type ReleaseChannel = 'preview' | 'stable';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  prerelease: boolean;
  asset: ReleaseAsset;
  checksumAsset: ReleaseAsset;
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 64 * 1024;

export async function findLatestRelease(
  channel: ReleaseChannel,
  fetcher: FetchLike = fetch,
): Promise<ReleaseInfo> {
  const response = await fetcher(
    `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=30`,
    {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'binaflow-updater' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`GitHub Releases request failed with HTTP ${response.status}`);
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error('GitHub Releases response was malformed');

  const candidates = releases
    .map((release) => parseRelease(release, channel))
    .filter((release): release is ReleaseInfo => release !== undefined)
    .sort((a, b) => compareVersions(b.version, a.version));
  const latest = candidates[0];
  if (!latest) throw new Error(`No usable ${channel} Binaflow release was found`);
  return latest;
}

export async function downloadChecksumAsset(
  asset: ReleaseAsset,
  fetcher: FetchLike = fetch,
): Promise<Uint8Array> {
  return downloadResponseBytes(asset, fetcher, MAX_CHECKSUM_BYTES);
}

async function downloadResponseBytes(
  asset: ReleaseAsset,
  fetcher: FetchLike,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > maxBytes) {
    throw new Error(`Refusing to download an oversized release asset: ${asset.name}`);
  }
  const response = await fetcher(asset.url, {
    headers: { 'user-agent': 'binaflow-updater' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`Download failed for ${asset.name} with HTTP ${response.status}`);
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length > maxBytes) {
      throw new Error(`Refusing to download an oversized response: ${asset.name}`);
    }
  }
  if (!response.body) throw new Error(`Download response for ${asset.name} had no body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      throw new Error(`Downloaded release asset exceeds the size limit: ${asset.name}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

export async function downloadAssetToFile(
  asset: ReleaseAsset,
  path: string,
  fetcher: FetchLike = fetch,
): Promise<string> {
  if (!Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Refusing to download an oversized release asset: ${asset.name}`);
  }
  const response = await fetcher(asset.url, {
    headers: { 'user-agent': 'binaflow-updater' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`Download failed for ${asset.name} with HTTP ${response.status}`);
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Refusing to download an oversized response: ${asset.name}`);
    }
  }
  if (!response.body) throw new Error(`Download response for ${asset.name} had no body`);

  const handle = await open(path, 'w');
  const hash = createHash('sha256');
  let size = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Downloaded release asset exceeds the size limit: ${asset.name}`);
      }
      hash.update(value);
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export function parseChecksum(text: string, assetName: string): string {
  const escapedName = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(new RegExp(`^([a-f0-9]{64})\\s+\\*?${escapedName}$`, 'i')))
    .find((candidate) => candidate !== null);
  if (!match) throw new Error(`Checksum asset for ${assetName} did not contain a SHA-256 digest`);
  const digest = match[1];
  if (!digest) throw new Error(`Checksum asset for ${assetName} did not contain a SHA-256 digest`);
  return digest.toLowerCase();
}

function parseRelease(value: unknown, channel: ReleaseChannel): ReleaseInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const release = value as Record<string, unknown>;
  if (
    release.draft === true ||
    typeof release.tag_name !== 'string' ||
    typeof release.prerelease !== 'boolean'
  )
    return undefined;
  if (channel === 'preview' ? !release.prerelease : release.prerelease) return undefined;
  const version = release.tag_name.replace(/^v/, '');
  if (!isVersion(version) || release.tag_name !== `v${version}`) return undefined;
  if (!Array.isArray(release.assets)) return undefined;
  const assets = release.assets
    .map(parseAsset)
    .filter((asset): asset is ReleaseAsset => asset !== undefined);
  const assetName = `binaflow-linux-x64-${version}.tar.gz`;
  const checksumName = `${assetName}.sha256`;
  const asset = assets.find((candidate) => candidate.name === assetName);
  const checksumAsset = assets.find((candidate) => candidate.name === checksumName);
  if (!asset || !checksumAsset) return undefined;
  return { version, tag: release.tag_name, prerelease: release.prerelease, asset, checksumAsset };
}

function parseAsset(value: unknown): ReleaseAsset | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const asset = value as Record<string, unknown>;
  if (
    typeof asset.name !== 'string' ||
    typeof asset.browser_download_url !== 'string' ||
    typeof asset.size !== 'number'
  )
    return undefined;
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined;
  return { name: asset.name, url: url.toString(), size: asset.size };
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

export function compareVersions(a: string, b: string): number {
  const [leftCoreText, leftPrerelease] = splitVersion(a);
  const [rightCoreText, rightPrerelease] = splitVersion(b);
  const leftCore = leftCoreText.split('.');
  const rightCore = rightCoreText.split('.');
  for (let index = 0; index < 3; index += 1) {
    const comparison = compareNumericIdentifiers(leftCore[index] ?? '', rightCore[index] ?? '');
    if (comparison !== 0) return comparison;
  }
  if (leftPrerelease === undefined && rightPrerelease !== undefined) return 1;
  if (leftPrerelease !== undefined && rightPrerelease === undefined) return -1;
  if (leftPrerelease === undefined || rightPrerelease === undefined) return 0;
  const leftIdentifiers = leftPrerelease.split('.');
  const rightIdentifiers = rightPrerelease.split('.');
  for (
    let index = 0;
    index < Math.max(leftIdentifiers.length, rightIdentifiers.length);
    index += 1
  ) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumericIdentifiers(leftIdentifier, rightIdentifier);
      if (comparison !== 0) return comparison;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (leftIdentifier !== rightIdentifier) {
      return leftIdentifier < rightIdentifier ? -1 : 1;
    }
  }
  return 0;
}

function splitVersion(version: string): [string, string | undefined] {
  const separator = version.indexOf('-');
  return separator < 0
    ? [version, undefined]
    : [version.slice(0, separator), version.slice(separator + 1)];
}

function compareNumericIdentifiers(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '');
  const normalizedRight = right.replace(/^0+(?=\d)/, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}
