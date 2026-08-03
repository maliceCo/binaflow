/* global process */

import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testReleaseRoot = join(root, 'testrelease');
const bundleDirectory = join(testReleaseRoot, 'binaflow');
const outputDirectory = await mkdtemp(join(dirname(root), '.binaflow-testrelease-'));
await mkdir(testReleaseRoot, { recursive: true });
const extractionDirectory = await mkdtemp(join(testReleaseRoot, '.staging-'));

try {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const archive = join(outputDirectory, `binaflow-linux-x64-${packageJson.version}.tar.gz`);

  execFileSync(
    process.execPath,
    [join(root, 'scripts', 'build-linux-bundle.mjs'), '--output-dir', outputDirectory],
    { cwd: root, stdio: 'inherit' },
  );
  execFileSync('tar', ['-xzf', archive, '-C', extractionDirectory], { stdio: 'inherit' });

  const previousDirectory = join(testReleaseRoot, `.previous-${process.pid}-${Date.now()}`);
  let previousMoved = false;
  try {
    if (await exists(bundleDirectory)) {
      await rename(bundleDirectory, previousDirectory);
      previousMoved = true;
    }
    await rename(join(extractionDirectory, 'binaflow'), bundleDirectory);
    if (previousMoved) await rm(previousDirectory, { recursive: true, force: true });
  } catch (error) {
    if (previousMoved && !(await exists(bundleDirectory))) {
      await rename(previousDirectory, bundleDirectory);
    }
    throw error;
  }
  process.stdout.write(`Created ${bundleDirectory}\n`);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
  await rm(extractionDirectory, { recursive: true, force: true });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
