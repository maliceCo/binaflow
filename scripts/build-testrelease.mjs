/* global process */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testReleaseRoot = join(root, 'testrelease');
const outputDirectory = await mkdtemp(join(dirname(root), '.binaflow-testrelease-'));
const extractionDirectory = await mkdtemp(join(dirname(root), '.binaflow-testrelease-'));

try {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const archive = join(outputDirectory, `binaflow-linux-x64-${packageJson.version}.tar.gz`);

  execFileSync(
    process.execPath,
    [join(root, 'scripts', 'build-linux-bundle.mjs'), '--output-dir', outputDirectory],
    { cwd: root, stdio: 'inherit' },
  );
  execFileSync('tar', ['-xzf', archive, '-C', extractionDirectory], { stdio: 'inherit' });

  await rm(testReleaseRoot, { recursive: true, force: true });
  await mkdir(testReleaseRoot, { recursive: true });
  await rename(join(extractionDirectory, 'binaflow'), join(testReleaseRoot, 'binaflow'));
  process.stdout.write(`Created ${join(testReleaseRoot, 'binaflow')}\n`);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
  await rm(extractionDirectory, { recursive: true, force: true });
}
