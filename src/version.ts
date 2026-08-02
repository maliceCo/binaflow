import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageMetadata {
  version?: unknown;
}

function loadVersion(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  for (const packagePath of [
    resolve(directory, '../package.json'),
    resolve(directory, '../../package.json'),
  ]) {
    if (!existsSync(packagePath)) continue;
    const metadata = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageMetadata;
    if (typeof metadata.version === 'string' && metadata.version.length > 0)
      return metadata.version;
  }
  throw new Error('Unable to locate package.json for the Binaflow version');
}

export const VERSION = loadVersion();
