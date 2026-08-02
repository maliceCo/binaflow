/* global process */

import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('The Linux bundle currently supports Linux x64 only');
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const outputFlag = process.argv.indexOf('--output-dir');
const outputDir = resolve(
  root,
  outputFlag >= 0 ? (process.argv[outputFlag + 1] ?? 'release') : 'release',
);
await mkdir(outputDir, { recursive: true });
const stageParent = await mkdtemp(join(dirname(root), '.binaflow-bundle-'));
const bundleRoot = join(stageParent, 'binaflow');
const appRoot = join(bundleRoot, 'app');

try {
  await mkdir(appRoot, { recursive: true });
  await cp(join(root, 'dist'), join(appRoot, 'dist'), { recursive: true });
  await copyFile(join(root, 'package.json'), join(appRoot, 'package.json'));
  await copyFile(join(root, 'pnpm-lock.yaml'), join(appRoot, 'pnpm-lock.yaml'));
  await writeFile(
    join(appRoot, 'pnpm-workspace.yaml'),
    'packages: []\nallowBuilds:\n  better-sqlite3: true\n',
  );
  execFileSync(
    'pnpm',
    [
      'install',
      '--prod',
      '--frozen-lockfile',
      '--dir',
      appRoot,
      '--config.allowBuilds.better-sqlite3=true',
    ],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  await rm(join(appRoot, 'pnpm-workspace.yaml'), { force: true });
  await rm(join(appRoot, 'pnpm-lock.yaml'), { force: true });
  await mkdir(join(bundleRoot, 'runtime', 'bin'), { recursive: true });
  await copyFile(process.execPath, join(bundleRoot, 'runtime', 'bin', 'node'));
  await mkdir(join(bundleRoot, 'bin'), { recursive: true });
  await copyFile(join(root, 'scripts', 'install-template.sh'), join(bundleRoot, 'install.sh'));
  await chmod(join(bundleRoot, 'install.sh'), 0o755);
  await copyFile(join(root, 'scripts', 'bundle-launcher.sh'), join(bundleRoot, 'bin', 'binaflow'));
  await chmod(join(bundleRoot, 'bin', 'binaflow'), 0o755);
  await copyFile(join(root, 'LICENSE'), join(bundleRoot, 'LICENSE'));

  const payloadSha256 = await hashPayload(bundleRoot);
  await writeFile(
    join(bundleRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        format: 'binaflow-linux-bundle-v1',
        version: packageJson.version,
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
        nodeVersion: process.version,
        checksumAlgorithm: 'sha256',
        payloadSha256,
      },
      null,
      2,
    )}\n`,
  );

  const assetName = `binaflow-linux-x64-${packageJson.version}.tar.gz`;
  const assetPath = join(outputDir, assetName);
  execFileSync('tar', ['-czf', assetPath, '-C', stageParent, 'binaflow'], { stdio: 'inherit' });
  const archiveDigest = createHash('sha256')
    .update(await readFile(assetPath))
    .digest('hex');
  await writeFile(join(outputDir, `${assetName}.sha256`), `${archiveDigest}  ${assetName}\n`);
  process.stdout.write(`Created ${assetPath}\n`);
} finally {
  await rm(stageParent, { recursive: true, force: true });
}

async function hashPayload(directory) {
  const hash = createHash('sha256');
  await visit(directory, directory, hash);
  return hash.digest('hex');
}

async function visit(rootDirectory, directory, hash) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const name = path.slice(rootDirectory.length + 1).replaceAll('\\', '/');
    if (name === 'manifest.json') continue;
    if (entry.isDirectory()) {
      hash.update(`directory:${name}\0`);
      await visit(rootDirectory, path, hash);
    } else if (entry.isFile()) {
      const data = await readFile(path);
      hash.update(`file:${name}:${data.byteLength}\0`);
      hash.update(data);
    } else if (entry.isSymbolicLink()) {
      hash.update(`symlink:${name}:${await readlink(path)}\0`);
    } else {
      throw new Error(`Unsupported bundle entry: ${name}`);
    }
  }
}
