import { RELEASE_REPOSITORY } from './paths.js';

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

export async function findLatestRelease(
  channel: ReleaseChannel,
  fetcher: FetchLike = fetch,
): Promise<ReleaseInfo> {
  const response = await fetcher(
    `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=30`,
    {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'binaflow-updater' },
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

export async function downloadAsset(
  asset: ReleaseAsset,
  fetcher: FetchLike = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(asset.url, { headers: { 'user-agent': 'binaflow-updater' } });
  if (!response.ok)
    throw new Error(`Download failed for ${asset.name} with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
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
  const left = a.split('-', 2);
  const right = b.split('-', 2);
  const leftCore = (left[0] ?? '').split('.').map(Number);
  const rightCore = (right[0] ?? '').split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftCore[index] !== rightCore[index])
      return (leftCore[index] ?? 0) - (rightCore[index] ?? 0);
  }
  if (left[1] === undefined && right[1] !== undefined) return 1;
  if (left[1] !== undefined && right[1] === undefined) return -1;
  return (left[1] ?? '').localeCompare(right[1] ?? '', undefined, { numeric: true });
}
