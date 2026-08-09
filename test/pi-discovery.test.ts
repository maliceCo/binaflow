import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverAgentModels } from '../src/application/config-operations.js';
import { PiModelDiscovery } from '../src/drivers/pi-discovery.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Pi model discovery', () => {
  it('maps catalogued models only for authenticated providers', async () => {
    const directory = await temporaryDirectory('binaflow-pi-discovery-');
    const authPath = join(directory, 'auth.json');
    const modelsPath = join(directory, 'models-store.json');
    await writeFile(authPath, JSON.stringify({ openai: { apiKey: 'secret' }, empty: {} }));
    await writeFile(
      modelsPath,
      JSON.stringify({
        models: {
          openai: [{ id: 'gpt-5', name: 'GPT 5' }, { id: 'gpt-5-mini' }, { name: 'missing id' }],
          anthropic: [{ id: 'claude-sonnet' }],
        },
      }),
    );

    await expect(new PiModelDiscovery({ authPath, modelsPath }).discoverModels()).resolves.toEqual([
      { provider: 'openai', model: 'gpt-5', displayName: 'GPT 5' },
      { provider: 'openai', model: 'gpt-5-mini' },
    ]);
  });

  it.each([
    { name: 'missing auth', auth: undefined, models: { openai: [{ id: 'gpt-5' }] } },
    { name: 'missing models', auth: { openai: { apiKey: 'secret' } }, models: undefined },
    { name: 'corrupt auth', auth: '{', models: { openai: [{ id: 'gpt-5' }] } },
    { name: 'corrupt models', auth: { openai: { apiKey: 'secret' } }, models: '[' },
  ])('returns an empty list for $name files', async ({ auth, models }) => {
    const directory = await temporaryDirectory('binaflow-pi-discovery-invalid-');
    const authPath = join(directory, 'auth.json');
    const modelsPath = join(directory, 'models-store.json');
    if (auth !== undefined) await writeFile(authPath, JSON.stringify(auth));
    if (models !== undefined) {
      await writeFile(modelsPath, typeof models === 'string' ? models : JSON.stringify(models));
    }

    await expect(new PiModelDiscovery({ authPath, modelsPath }).discoverModels()).resolves.toEqual(
      [],
    );
  });

  it('keeps the application operation empty when a discovery adapter fails', async () => {
    await expect(
      discoverAgentModels({
        discoverModels: async () => {
          throw new Error('invalid Pi files');
        },
      }),
    ).resolves.toEqual([]);
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(directory, { recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}
