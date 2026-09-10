/* global process */

import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows bundle currently supports Windows x64 only');
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const outputFlag = process.argv.indexOf('--output-dir');
const outputDir = resolve(
  root,
  outputFlag >= 0 ? (process.argv[outputFlag + 1] ?? 'release') : 'release',
);
await mkdir(outputDir, { recursive: true });
const stageParent = await mkdtemp(join(dirname(root), '.binaflow-windows-bundle-'));
const bundleRoot = join(stageParent, 'binaflow');
const appRoot = join(bundleRoot, 'app');
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

try {
  await mkdir(appRoot, { recursive: true });
  await cp(join(root, 'dist'), join(appRoot, 'dist'), { recursive: true });
  await copyFile(join(root, 'package.json'), join(appRoot, 'package.json'));
  await writeFile(join(appRoot, '.npmrc'), 'allow-scripts=better-sqlite3\n');
  execFileSync(
    process.execPath,
    [npmCli, 'install', '--omit=dev', '--no-package-lock', '--prefix', appRoot],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  await rm(join(appRoot, '.npmrc'), { force: true });
  await mkdir(join(bundleRoot, 'runtime', 'bin'), { recursive: true });
  await copyFile(process.execPath, join(bundleRoot, 'runtime', 'bin', 'node.exe'));
  await mkdir(join(bundleRoot, 'bin'), { recursive: true });
  await writeFile(
    join(bundleRoot, 'bin', 'binaflow.cmd'),
    '@echo off\r\nsetlocal\r\nset "ROOT=%~dp0.."\r\n"%ROOT%\\runtime\\bin\\node.exe" "%ROOT%\\app\\dist\\src\\cli\\index.js" %*\r\nexit /b %errorlevel%\r\n',
  );
  await copyFile(join(root, 'LICENSE'), join(bundleRoot, 'LICENSE'));

  const payloadSha256 = await hashPayload(bundleRoot);
  await writeFile(
    join(bundleRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        format: 'binaflow-windows-bundle-v1',
        version: packageJson.version,
        platform: 'win32',
        arch: 'x64',
        nodeVersion: process.version,
        checksumAlgorithm: 'sha256',
        payloadSha256,
      },
      null,
      2,
    )}\n`,
  );

  const assetName = `binaflow-windows-x64-${packageJson.version}.zip`;
  const assetPath = join(outputDir, assetName);
  execFileSync('tar.exe', ['-a', '-c', '-f', assetPath, '-C', stageParent, 'binaflow'], {
    stdio: 'inherit',
  });
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
      throw new Error(`Unsupported symbolic link in Windows bundle: ${name}`);
    } else {
      throw new Error(`Unsupported bundle entry: ${name}`);
    }
  }
}
