import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentModel, AgentModelDiscovery } from '../core/agent.js';

export interface PiDiscoveryPaths {
  authPath?: string;
  modelsPath?: string;
}

export class PiModelDiscovery implements AgentModelDiscovery {
  private readonly authPath: string;
  private readonly modelsPath: string;

  constructor(paths: PiDiscoveryPaths = {}) {
    const piDirectory = join(homedir(), '.pi', 'agent');
    this.authPath = paths.authPath ?? join(piDirectory, 'auth.json');
    this.modelsPath = paths.modelsPath ?? join(piDirectory, 'models-store.json');
  }

  async discoverModels(): Promise<AgentModel[]> {
    try {
      const [auth, models] = await Promise.all([
        readJson(this.authPath),
        readJson(this.modelsPath),
      ]);
      return mapModels(auth, models);
    } catch {
      return [];
    }
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function mapModels(authValue: unknown, modelsValue: unknown): AgentModel[] {
  const authenticatedProviders = authenticatedProviderNames(authValue);
  const root = asRecord(modelsValue);
  const models = asRecord(root?.models) ?? root;
  if (!models) return [];

  const result: AgentModel[] = [];
  for (const [provider, value] of Object.entries(models)) {
    if (!authenticatedProviders.has(provider)) continue;
    const entries = Array.isArray(value) ? value : asRecord(value)?.models;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const model = asRecord(entry);
      if (typeof model?.id !== 'string' || !model.id.trim()) continue;
      result.push({
        provider,
        model: model.id,
        ...(typeof model.name === 'string' && model.name.trim() ? { displayName: model.name } : {}),
      });
    }
  }
  return result;
}

function authenticatedProviderNames(value: unknown): Set<string> {
  const record = asRecord(value);
  if (!record) return new Set();
  return new Set(
    Object.entries(record)
      .filter(([, credentials]) => hasCredential(credentials))
      .map(([provider]) => provider),
  );
}

function hasCredential(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  const record = asRecord(value);
  return (
    record !== undefined &&
    Object.values(record).some((item) => {
      if (typeof item === 'string') return item.trim().length > 0;
      return item !== null && item !== undefined;
    })
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
