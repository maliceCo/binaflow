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
          specifier.includes('/tui/') ||
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
      ...(await listSourceFiles(join(root, 'src/tui'))),
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
    const publicSurface = ['ApplicationQueries', 'ApplicationCommands', 'ApplicationService']
      .map((name) => interfaceSource(source, name))
      .join('\n');
    expect(publicSurface).not.toMatch(/\bstore\b/);
    expect(publicSurface).not.toMatch(/\bartifacts\b/);
    expect(publicSurface).not.toMatch(/\bengine\b/);
    expect(publicSurface).not.toMatch(/\bprofiles\b/);
    expect(publicSurface).not.toMatch(/\bclose\b/);
    expect(publicSurface).toMatch(/inspectRun/);
    expect(publicSurface).toMatch(/runWorkflow/);
    expect(publicSurface).toMatch(/subscribeEvents/);
  });

  it('keeps lifecycle ownership on contexts and separates query-only storage', async () => {
    const runtime = await readFile(join(root, 'src/application/runtime.ts'), 'utf8');
    const storage = runtime.match(
      /export async function openApplicationStorage[\s\S]*?(?=\nexport function createRuntimeEventSink)/,
    );
    expect(runtime).toMatch(
      /interface ApplicationContext \{[\s\S]*application: ApplicationService/,
    );
    expect(runtime).toMatch(
      /interface ApplicationStorageContext \{[\s\S]*application: ApplicationQueries/,
    );
    expect(storage).toBeTruthy();
    expect(storage![0]).not.toMatch(/WorkflowEngine|PiDriver|ResearchPlanBuildCoordinator/);
  });
});

function interfaceSource(source: string, name: string): string {
  const match = source.match(
    new RegExp(`export interface ${name}(?: extends [^{]+)? \\{[\\s\\S]*?\\n\\}`),
  );
  expect(match, `Missing ${name} interface`).toBeTruthy();
  return match![0]!;
}
