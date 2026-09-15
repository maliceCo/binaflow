import { mkdir, copyFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const outputDirectory = join(root, 'dist', 'web');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'web', 'client', 'main.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: join(outputDirectory, 'app.js'),
  sourcemap: false,
  legalComments: 'none',
});

for (const asset of ['index.html', 'styles.css']) {
  await mkdir(dirname(join(outputDirectory, asset)), { recursive: true });
  await copyFile(join(root, 'src', 'web', 'client', asset), join(outputDirectory, asset));
}
