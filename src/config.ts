import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type WorkspaceMode = 'read-only' | 'read-write';
export type ProjectTrust = 'never' | 'always';

export interface AgentProfile {
  driver: string;
  provider?: string;
  model: string;
  thinking?: string;
  tools: string[];
  workspaceMode: WorkspaceMode;
  projectTrust?: ProjectTrust;
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
  if (parsed.dataDir !== undefined && typeof parsed.dataDir !== 'string') {
    throw new Error('Binaflow config dataDir must be a string');
  }
  if (parsed.piCommand !== undefined && typeof parsed.piCommand !== 'string') {
    throw new Error('Binaflow config piCommand must be a string');
  }
  const dataDir = parsed.dataDir ?? './data';
  return {
    dataDir: resolve(dirname(absoluteConfigPath), dataDir),
    piCommand: parsed.piCommand ?? 'pi',
    profiles,
  };
}

export async function loadDataDir(configPath: string, cwd = process.cwd()): Promise<string> {
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
  if (parsed.dataDir !== undefined && typeof parsed.dataDir !== 'string') {
    throw new Error('Binaflow config dataDir must be a string');
  }
  return resolve(dirname(absoluteConfigPath), parsed.dataDir ?? './data');
}

function parseProfile(name: string, value: unknown): AgentProfile {
  if (!isRecord(value)) throw new Error(`Profile ${name} must be an object`);
  if (
    typeof value.driver !== 'string' ||
    !value.driver.trim() ||
    value.driver !== 'pi' ||
    typeof value.model !== 'string' ||
    !value.model.trim() ||
    !Array.isArray(value.tools) ||
    !value.tools.every(
      (tool) => typeof tool === 'string' && tool.length > 0 && tool === tool.trim(),
    ) ||
    (value.workspaceMode !== 'read-only' && value.workspaceMode !== 'read-write') ||
    !isPositiveInteger(value.timeoutMs) ||
    !isNonNegativeInteger(value.retryLimit)
  ) {
    throw new Error(
      `Profile ${name} has invalid driver, model, tools, workspaceMode, timeoutMs, or retryLimit; driver must be pi and tools must be non-empty names`,
    );
  }
  if (
    value.projectTrust !== undefined &&
    value.projectTrust !== 'never' &&
    value.projectTrust !== 'always'
  ) {
    throw new Error(`Profile ${name} has invalid projectTrust; expected never or always`);
  }
  if (
    value.provider !== undefined &&
    (typeof value.provider !== 'string' || !value.provider.trim())
  ) {
    throw new Error(`Profile ${name} provider must be a non-empty string`);
  }
  if (value.thinking !== undefined && typeof value.thinking !== 'string') {
    throw new Error(`Profile ${name} thinking must be a string`);
  }
  const profile: AgentProfile = {
    driver: value.driver,
    model: value.model,
    tools: value.tools,
    workspaceMode: value.workspaceMode,
    timeoutMs: value.timeoutMs,
    retryLimit: value.retryLimit,
  };
  if (value.projectTrust === 'never' || value.projectTrust === 'always') {
    profile.projectTrust = value.projectTrust;
  }
  if (typeof value.provider === 'string') profile.provider = value.provider;
  if (typeof value.thinking === 'string') profile.thinking = value.thinking;
  return profile;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
