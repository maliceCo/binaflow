import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(path)));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(path);
    }
  }
  return files;
}

function importsOf(source: string): string[] {
  const matches = source.matchAll(/from\s+['"]([^'"]+)['"]/g);
  return [...matches].map((match) => match[1]!);
}

describe('architecture boundaries', () => {
  it('keeps core free of presentation, concrete workflows, Pi, and storage adapters', async () => {
    const files = await listSourceFiles(join(root, 'src/core'));
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importsOf(source)) {
        if (
          specifier.includes('/cli/') ||
          specifier.includes('/tui') ||
          specifier.includes('/tui-ink/') ||
          specifier.includes('/workflows/') ||
          specifier.includes('/drivers/pi-rpc') ||
          specifier.includes('/storage/sqlite-') ||
          specifier.includes('/artifacts/file-') ||
          specifier.includes('/presentation/')
        ) {
          violations.push(`${relative(root, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps CLI and Ink presentation free of stores, Pi, and the concrete engine', async () => {
    const files = [
      ...(await listSourceFiles(join(root, 'src/cli'))),
      ...(await listSourceFiles(join(root, 'src/tui-ink'))),
    ];
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importsOf(source)) {
        if (
          specifier.includes('/storage/sqlite-') ||
          specifier.includes('/artifacts/file-') ||
          specifier.includes('/drivers/pi-rpc') ||
          specifier.includes('/core/engine') ||
          specifier.includes('/storage/run-store')
        ) {
          violations.push(`${relative(root, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not expose infrastructure fields on ApplicationService', async () => {
    const source = await readFile(join(root, 'src/application/service.ts'), 'utf8');
    const match = source.match(/export interface ApplicationService \{[\s\S]*?\n\}/);
    expect(match).toBeTruthy();
    const iface = match![0]!;
    expect(iface).not.toMatch(/\bstore\b/);
    expect(iface).not.toMatch(/\bartifacts\b/);
    expect(iface).not.toMatch(/\bengine\b/);
  });
});
