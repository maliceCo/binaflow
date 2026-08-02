import { createHash } from 'node:crypto';
import { lstat, readdir, readlink, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export interface BundleManifest {
  format: 'binaflow-linux-bundle-v1';
  version: string;
  platform: 'linux';
  arch: 'x64';
  libc: 'glibc';
  nodeVersion: string;
  checksumAlgorithm: 'sha256';
  payloadSha256: string;
}

export function parseManifest(value: unknown): BundleManifest {
  if (!value || typeof value !== 'object') throw new Error('Bundle manifest must be an object');
  const manifest = value as Record<string, unknown>;
  const fields = [
    'format',
    'version',
    'platform',
    'arch',
    'libc',
    'nodeVersion',
    'checksumAlgorithm',
    'payloadSha256',
  ];
  for (const field of fields) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`Bundle manifest field ${field} is missing or invalid`);
    }
  }
  if (manifest.format !== 'binaflow-linux-bundle-v1') throw new Error('Unsupported bundle format');
  if (manifest.platform !== 'linux' || manifest.arch !== 'x64' || manifest.libc !== 'glibc') {
    throw new Error('Bundle is not for Linux x64/glibc');
  }
  if (
    manifest.checksumAlgorithm !== 'sha256' ||
    !/^[a-f0-9]{64}$/i.test(manifest.payloadSha256 as string)
  ) {
    throw new Error('Bundle manifest checksum is invalid');
  }
  return manifest as unknown as BundleManifest;
}

export async function payloadSha256(root: string): Promise<string> {
  const hash = createHash('sha256');
  await hashDirectory(resolve(root), resolve(root), hash);
  return hash.digest('hex');
}

async function hashDirectory(
  root: string,
  directory: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const name = relative(root, path).split(sep).join('/');
    if (name === 'manifest.json') continue;
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await readlink(path);
      hash.update(`symlink:${name}:${target}\0`);
      continue;
    }
    if (entry.isDirectory()) {
      hash.update(`directory:${name}\0`);
      await hashDirectory(root, path, hash);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported bundle entry: ${name}`);
    hash.update(`file:${name}:${info.size}\0`);
    hash.update(await readFile(path));
  }
}
