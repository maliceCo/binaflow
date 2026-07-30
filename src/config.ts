import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type WorkspaceMode = 'read-only' | 'read-write';

export interface AgentProfile {
  driver: string;
  provider?: string;
  model: string;
  thinking?: string;
  tools: string[];
  workspaceMode: WorkspaceMode;
  timeoutMs: number;
  retryLimit: number;
}

export interface BinaflowConfig {
  dataDir: string;
  piCommand: string;
  profiles: Record<string, AgentProfile>;
}

export function resolveProfile(
  config: Pick<BinaflowConfig, 'profiles'>,
  profileName: string,
): AgentProfile {
  const profile = config.profiles[profileName];
  if (!profile) throw new Error(`Unknown agent profile: ${profileName}`);
  return profile;
}

export async function loadConfig(configPath: string, cwd = process.cwd()): Promise<BinaflowConfig> {
  const absoluteConfigPath = resolve(cwd, configPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absoluteConfigPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot read Binaflow config ${absoluteConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) throw new Error('Binaflow config must be a JSON object');
  if (!isRecord(parsed.profiles)) throw new Error('Binaflow config requires a profiles object');

  const profiles: Record<string, AgentProfile> = {};
  for (const [name, value] of Object.entries(parsed.profiles)) {
    profiles[name] = parseProfile(name, value);
  }
  const dataDir = typeof parsed.dataDir === 'string' ? parsed.dataDir : './data';
  return {
    dataDir: resolve(dirname(absoluteConfigPath), dataDir),
    piCommand: typeof parsed.piCommand === 'string' ? parsed.piCommand : 'pi',
    profiles,
  };
}

function parseProfile(name: string, value: unknown): AgentProfile {
  if (!isRecord(value)) throw new Error(`Profile ${name} must be an object`);
  if (
    typeof value.driver !== 'string' ||
    typeof value.model !== 'string' ||
    !Array.isArray(value.tools) ||
    !value.tools.every((tool) => typeof tool === 'string') ||
    (value.workspaceMode !== 'read-only' && value.workspaceMode !== 'read-write') ||
    typeof value.timeoutMs !== 'number' ||
    typeof value.retryLimit !== 'number'
  ) {
    throw new Error(
      `Profile ${name} has invalid driver, model, tools, workspaceMode, timeoutMs, or retryLimit`,
    );
  }
  const profile: AgentProfile = {
    driver: value.driver,
    model: value.model,
    tools: value.tools,
    workspaceMode: value.workspaceMode,
    timeoutMs: value.timeoutMs,
    retryLimit: value.retryLimit,
  };
  if (typeof value.provider === 'string') profile.provider = value.provider;
  if (typeof value.thinking === 'string') profile.thinking = value.thinking;
  return profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
