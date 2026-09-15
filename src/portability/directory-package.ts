import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  PORTABILITY_LIMITS,
  PortabilityContractError,
  assertFileLimits,
  parseTransferManifest,
  type TransferFileHash,
  type TransferManifest,
  validatePortablePath,
} from '../application/portability.js';

const STAGING_METADATA = '.staging.json';
const MANIFEST_FILE = 'manifest.json';

interface StagingMetadata {
  token: string;
  requestId: string;
  transferId: string;
}

export interface CopyAndHashRequest {
  sourcePath: string;
  destinationPath: string;
  expected?: { sha256: string; sizeBytes: number };
}

export interface StagingPackageRequest {
  destination: string;
  requestId: string;
  transferId: string;
}

export async function createStagingPackage(
  request: StagingPackageRequest | string,
  requestId?: string,
  transferId?: string,
): Promise<string> {
  const input: StagingPackageRequest =
    typeof request === 'string'
      ? { destination: request, requestId: requestId ?? '', transferId: transferId ?? '' }
      : request;
  if (!input.destination || !input.requestId || !input.transferId) {
    throw packageError(
      'invalid-input',
      'Staging package requires destination and ownership metadata',
    );
  }
  const destination = resolve(input.destination);
  assertPackageDestinationAvailable(destination);
  const stagingPath = `${destination}.staging-${randomUUID()}`;
  await mkdir(join(stagingPath, 'artifacts'), { recursive: true, mode: 0o700 });
  const metadata: StagingMetadata = {
    token: randomUUID(),
    requestId: input.requestId,
    transferId: input.transferId,
  };
  await writePrivateFile(
    join(stagingPath, STAGING_METADATA),
    `${JSON.stringify(metadata)}\n`,
    true,
  );
  await syncDirectory(stagingPath);
  return stagingPath;
}

export async function copyAndHashArtifact(
  request: CopyAndHashRequest | string,
  destinationPath?: string,
  expected?: CopyAndHashRequest['expected'],
): Promise<TransferFileHash> {
  const input: CopyAndHashRequest =
    typeof request === 'string'
      ? {
          sourcePath: request,
          destinationPath: destinationPath ?? '',
          ...(expected ? { expected } : {}),
        }
      : request;
  if (!input.destinationPath)
    throw packageError('invalid-input', 'Artifact destination is required');
  const source = await inspectRegularFile(input.sourcePath);
  assertFileLimits(Number(source.size), input.sourcePath);
  const destination = resolve(input.destinationPath);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const sourceBefore = await lstat(input.sourcePath);
  let output;
  try {
    output = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const stream = createReadStream(input.sourcePath);
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sizeBytes += buffer.byteLength;
        if (sizeBytes > PORTABILITY_LIMITS.maxFileBytes) {
          throw packageError('limit-exceeded', 'Artifact exceeds the per-file size limit');
        }
        hash.update(buffer);
        await output.write(buffer);
      }
    } finally {
      stream.destroy();
    }
    await output.sync();
    await output.close();
    output = undefined;
    const sourceAfter = await lstat(input.sourcePath);
    if (
      sourceAfter.dev !== sourceBefore.dev ||
      sourceAfter.ino !== sourceBefore.ino ||
      sourceAfter.size !== sourceBefore.size ||
      sourceAfter.mtimeMs !== sourceBefore.mtimeMs ||
      sourceAfter.nlink !== sourceBefore.nlink
    ) {
      throw packageError('invalid-artifact', 'Artifact changed while it was copied');
    }
    const sha256 = hash.digest('hex');
    if (
      input.expected &&
      (input.expected.sha256 !== sha256 || input.expected.sizeBytes !== sizeBytes)
    ) {
      throw packageError('invalid-artifact', 'Artifact does not match its expected hash or size');
    }
    return { path: relative(resolve(dirname(destination), '..'), destination), sha256, sizeBytes };
  } catch (error) {
    await output?.close().catch(() => undefined);
    await rm(destination, { force: true });
    throw error;
  }
}

export async function writeManifestLast(
  packagePath: string,
  manifest: TransferManifest,
): Promise<void> {
  const parsed = parseTransferManifest(manifest);
  const packageRoot = resolve(packagePath);
  await assertOwnedStaging(packageRoot);
  const manifestPath = join(packageRoot, MANIFEST_FILE);
  try {
    await lstat(manifestPath);
    throw packageError('invalid-input', 'Package manifest already exists');
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await writePrivateFile(manifestPath, `${JSON.stringify(parsed)}\n`, true);
  await syncDirectory(packageRoot);
}

export async function finalizePackage(stagingPath: string, destination: string): Promise<string> {
  const source = resolve(stagingPath);
  const target = resolve(destination);
  await assertOwnedStaging(source);
  assertPackageDestinationAvailable(target);
  if (dirname(source) !== dirname(target)) {
    throw packageError(
      'invalid-input',
      'Package staging and destination must share a filesystem directory',
    );
  }
  await rm(join(source, STAGING_METADATA), { force: false });
  await rename(source, target);
  await syncDirectory(dirname(target));
  return target;
}

export async function inspectPackage(packagePath: string): Promise<TransferManifest> {
  const root = resolve(packagePath);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw packageError('invalid-input', 'Transfer package must be a directory');
  }
  const manifest = parseTransferManifest(
    JSON.parse(await readFile(join(root, MANIFEST_FILE), 'utf8')),
  );
  const expected = new Map<string, TransferFileHash>();
  expected.set(manifest.files.database.path, manifest.files.database);
  expected.set(manifest.files.bundle.path, manifest.files.bundle);
  for (const artifact of manifest.files.artifacts) expected.set(artifact.path, artifact);
  const files = await collectRegularFiles(root);
  const packageFiles = files.filter((path) => path !== MANIFEST_FILE && path !== STAGING_METADATA);
  if (packageFiles.length !== expected.size) {
    throw packageError('invalid-manifest', 'Package files do not match the manifest');
  }
  let totalBytes = 0;
  for (const path of packageFiles) {
    const expectedFile = expected.get(path);
    if (!expectedFile) throw packageError('invalid-manifest', 'Package contains an unlisted file');
    const actual = await hashRegularFile(join(root, path));
    if (actual.sizeBytes !== expectedFile.sizeBytes || actual.sha256 !== expectedFile.sha256) {
      throw packageError('invalid-artifact', `Package file does not match manifest: ${path}`);
    }
    totalBytes += actual.sizeBytes;
  }
  if (totalBytes > PORTABILITY_LIMITS.maxTotalBytes) {
    throw packageError('limit-exceeded', 'Transfer package exceeds the total size limit');
  }
  return manifest;
}

export async function materializeImportStaging(
  packagePath: string,
  outputDataDir: string,
): Promise<string> {
  const manifest = await inspectPackage(packagePath);
  void manifest;
  const target = resolve(outputDataDir);
  assertPackageDestinationAvailable(target);
  const stagingPath = `${target}.staging-${randomUUID()}`;
  await mkdir(join(stagingPath, 'artifacts'), { recursive: true, mode: 0o700 });
  const metadata: StagingMetadata = {
    token: randomUUID(),
    requestId: 'import',
    transferId: 'import',
  };
  await writePrivateFile(
    join(stagingPath, STAGING_METADATA),
    `${JSON.stringify(metadata)}\n`,
    true,
  );
  for (const path of await collectRegularFiles(resolve(packagePath))) {
    if (path === MANIFEST_FILE || path === STAGING_METADATA) continue;
    await copyAndHashArtifact({
      sourcePath: join(resolve(packagePath), path),
      destinationPath: join(stagingPath, path),
    });
  }
  await writePrivateFile(
    join(stagingPath, MANIFEST_FILE),
    await readFile(join(resolve(packagePath), MANIFEST_FILE), 'utf8'),
    true,
  );
  await syncDirectory(stagingPath);
  return stagingPath;
}

export async function cleanupOwnedStaging(stagingPath: string, requestId: string): Promise<void> {
  const root = resolve(stagingPath);
  const metadata = await readStagingMetadata(root);
  if (metadata.requestId !== requestId) {
    throw packageError('invalid-input', 'Staging package ownership does not match request');
  }
  await rm(root, { recursive: true, force: false });
}

async function inspectRegularFile(path: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) {
    throw packageError('invalid-artifact', 'Only regular, non-linked artifacts are allowed');
  }
  return file;
}

async function hashRegularFile(path: string): Promise<TransferFileHash> {
  const file = await inspectRegularFile(path);
  assertFileLimits(Number(file.size), path);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    hash.update(buffer);
  }
  return { path: '', sha256: hash.digest('hex'), sizeBytes };
}

async function collectRegularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute).split('\\').join('/');
      validatePortablePath(relativePath);
      if (entry.isSymbolicLink())
        throw packageError('invalid-artifact', 'Package cannot contain symlinks');
      if (entry.isDirectory()) await visit(absolute);
      else {
        const file = await inspectRegularFile(absolute);
        if (file.isFile()) files.push(relativePath);
      }
    }
  }
  await visit(root);
  return files;
}

async function assertOwnedStaging(path: string): Promise<StagingMetadata> {
  const metadata = await readStagingMetadata(path);
  if (!metadata.token || !metadata.requestId || !metadata.transferId) {
    throw packageError('invalid-input', 'Staging metadata is invalid');
  }
  return metadata;
}

async function readStagingMetadata(path: string): Promise<StagingMetadata> {
  try {
    return JSON.parse(await readFile(join(path, STAGING_METADATA), 'utf8')) as StagingMetadata;
  } catch (error) {
    throw packageError(
      'invalid-input',
      `Owned staging metadata is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertPackageDestinationAvailable(path: string): void {
  try {
    lstatSync(path);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  throw packageError('output-exists', 'Transfer output already exists');
}

async function writePrivateFile(path: string, content: string, exclusive: boolean): Promise<void> {
  const handle = await open(path, exclusive ? 'wx' : 'w', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function packageError(code: string, message: string): PortabilityContractError {
  return new PortabilityContractError(
    code as ConstructorParameters<typeof PortabilityContractError>[0],
    message,
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
