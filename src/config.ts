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
  const profile = Object.prototype.hasOwnProperty.call(config.profiles, profileName)
    ? config.profiles[profileName]
    : undefined;
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
  return parseConfigValue(parsed, absoluteConfigPath);
}

export function parseConfigValue(parsed: unknown, absoluteConfigPath: string): BinaflowConfig {
  if (!isRecord(parsed)) throw new Error('Binaflow config must be a JSON object');
  if (!isRecord(parsed.profiles)) throw new Error('Binaflow config requires a profiles object');

  const profiles: Record<string, AgentProfile> = Object.create(null) as Record<
    string,
    AgentProfile
  >;
  for (const [name, value] of Object.entries(parsed.profiles)) {
    profiles[name] = parseProfile(name, value);
  }
  if (parsed.dataDir !== undefined && typeof parsed.dataDir !== 'string') {
    throw new Error('Binaflow config dataDir must be a string');
  }
  const piCommandErrors = validatePiCommand(parsed.piCommand);
  if (piCommandErrors.length > 0) {
    throw new Error(`Binaflow config ${piCommandErrors.join('; ')}`);
  }
  const dataDir = parsed.dataDir ?? './data';
  const piCommand = typeof parsed.piCommand === 'string' ? parsed.piCommand : 'pi';
  return {
    dataDir: resolve(dirname(absoluteConfigPath), dataDir),
    piCommand,
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
  const result = validateAgentProfile(name, value);
  if (result.errors.length > 0) {
    throw new Error(`Profile ${name} has invalid configuration: ${result.errors.join('; ')}`);
  }
  return result.profile!;
}

export interface AgentProfileValidation {
  profile?: AgentProfile;
  errors: string[];
}

export function validateAgentProfile(name: string, value: unknown): AgentProfileValidation {
  if (isUnsafeProfileName(name)) return { errors: ['profile name is reserved'] };
  if (!isRecord(value)) return { errors: ['must be an object'] };
  const errors: string[] = [];
  if (value.driver !== 'pi') errors.push('driver must be pi');
  if (typeof value.model !== 'string' || !value.model.trim()) {
    errors.push('model must be a non-empty string');
  }
  if (
    !Array.isArray(value.tools) ||
    !value.tools.every(
      (tool) => typeof tool === 'string' && tool.length > 0 && tool === tool.trim(),
    )
  ) {
    errors.push('tools must contain non-empty names');
  }
  if (value.workspaceMode !== 'read-only' && value.workspaceMode !== 'read-write') {
    errors.push('workspaceMode must be read-only or read-write');
  }
  if (
    value.workspaceMode === 'read-only' &&
    Array.isArray(value.tools) &&
    value.tools.some((tool) => tool === 'write' || tool === 'edit' || tool === 'bash')
  ) {
    errors.push('read-only profiles cannot enable write, edit, or bash tools');
  }
  if (!isPositiveInteger(value.timeoutMs)) errors.push('timeoutMs must be a positive integer');
  if (!isNonNegativeInteger(value.retryLimit)) {
    errors.push('retryLimit must be a non-negative integer');
  }
  if (
    value.projectTrust !== undefined &&
    value.projectTrust !== 'never' &&
    value.projectTrust !== 'always'
  ) {
    errors.push('projectTrust must be never or always');
  }
  if (
    value.provider !== undefined &&
    (typeof value.provider !== 'string' || !value.provider.trim())
  ) {
    errors.push('provider must be a non-empty string');
  }
  if (value.thinking !== undefined && typeof value.thinking !== 'string') {
    errors.push('thinking must be a string');
  }
  if (errors.length > 0) return { errors };

  const profile: AgentProfile = {
    driver: 'pi',
    model: value.model as string,
    tools: value.tools as string[],
    workspaceMode: value.workspaceMode as WorkspaceMode,
    timeoutMs: value.timeoutMs as number,
    retryLimit: value.retryLimit as number,
  };
  if (value.projectTrust === 'never' || value.projectTrust === 'always') {
    profile.projectTrust = value.projectTrust;
  }
  if (typeof value.provider === 'string') profile.provider = value.provider;
  if (typeof value.thinking === 'string') profile.thinking = value.thinking;
  return { profile, errors };
}

export function validatePiCommand(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value !== 'string') return ['piCommand must be a string'];
  if (!value.trim()) return ['piCommand must be a non-empty string'];
  if (value.includes('\0')) return ['piCommand must not contain NUL bytes'];
  return [];
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

function isUnsafeProfileName(name: string): boolean {
  return name === '__proto__' || name === 'prototype' || name === 'constructor';
}
