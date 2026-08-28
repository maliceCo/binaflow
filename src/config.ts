import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AgentProfile, SkillPolicy, WorkspaceMode } from './core/agent-profile.js';
import { isReadOnlyPiTool } from './pi-tools.js';

export type {
  AgentProfile,
  ProjectTrust,
  SkillPolicy,
  WorkspaceMode,
} from './core/agent-profile.js';
export { resolveProfile } from './core/agent-profile.js';

export interface QaHistoryConfig {
  enabled: boolean;
}

export interface BinaflowConfig {
  dataDir: string;
  piCommand: string;
  profiles: Record<string, AgentProfile>;
  qaHistory: QaHistoryConfig;
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
    profiles[name] = parseProfile(name, value, absoluteConfigPath);
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
  const qaHistory = parseQaHistory(parsed.qaHistory);
  return {
    dataDir: resolve(dirname(absoluteConfigPath), dataDir),
    piCommand,
    profiles,
    qaHistory,
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

function parseProfile(name: string, value: unknown, configPath: string): AgentProfile {
  const result = validateAgentProfile(name, value, configPath);
  if (result.errors.length > 0) {
    throw new Error(`Profile ${name} has invalid configuration: ${result.errors.join('; ')}`);
  }
  return result.profile!;
}

export interface AgentProfileValidation {
  profile?: AgentProfile;
  errors: string[];
}

export function validateAgentProfile(
  name: string,
  value: unknown,
  configPath?: string,
): AgentProfileValidation {
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
    value.tools.some((tool) => !isReadOnlyPiTool(tool))
  ) {
    if (value.tools.some((tool) => tool === 'write' || tool === 'edit' || tool === 'bash')) {
      errors.push('read-only profiles cannot enable write, edit, or bash tools');
    } else {
      errors.push('read-only profiles may only enable ls, find, or read tools');
    }
  }
  if (
    name === 'planner' &&
    (value.workspaceMode !== 'read-only' ||
      (Array.isArray(value.tools) && value.tools.some((tool) => !isReadOnlyPiTool(tool))))
  ) {
    errors.push('planner profiles must be read-only and may only enable ls, find, or read tools');
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
  const skills = parseSkillPolicy(value.skills, configPath, errors);
  if (errors.length > 0) return { errors };

  const profile: AgentProfile = {
    driver: 'pi',
    model: value.model as string,
    tools: value.tools as string[],
    workspaceMode: value.workspaceMode as WorkspaceMode,
    timeoutMs: value.timeoutMs as number,
    retryLimit: value.retryLimit as number,
    skills,
  };
  if (value.projectTrust === 'never' || value.projectTrust === 'always') {
    profile.projectTrust = value.projectTrust;
  }
  if (typeof value.provider === 'string') profile.provider = value.provider;
  if (typeof value.thinking === 'string') profile.thinking = value.thinking;
  return { profile, errors };
}

function parseSkillPolicy(
  value: unknown,
  configPath: string | undefined,
  errors: string[],
): SkillPolicy {
  if (value === undefined) return { mode: 'discover' };
  if (!isRecord(value)) {
    errors.push('skills must be an object');
    return { mode: 'discover' };
  }

  const mode = value.mode;
  if (mode === 'discover' || mode === 'none') {
    if (value.paths !== undefined || value.required !== undefined) {
      errors.push(`skills mode ${mode} cannot define paths or required names`);
    }
    return { mode };
  }
  if (mode !== 'only') {
    errors.push('skills mode must be discover, none, or only');
    return { mode: 'discover' };
  }

  const paths = value.paths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((path) => typeof path === 'string' && path.trim().length > 0)
  ) {
    errors.push('skills only mode requires non-empty paths');
  }
  const required = value.required;
  if (
    required !== undefined &&
    (!Array.isArray(required) ||
      !required.every((name) => typeof name === 'string' && name.trim().length > 0))
  ) {
    errors.push('skills required must contain non-empty names');
  }
  if (Array.isArray(required) && new Set(required).size !== required.length) {
    errors.push('skills required names must be unique');
  }
  if (errors.length > 0) return { mode: 'discover' };

  const resolvedPaths = (paths as string[]).map((path) =>
    configPath ? resolve(dirname(configPath), path) : path,
  );
  return {
    mode: 'only',
    paths: resolvedPaths,
    ...(Array.isArray(required) ? { required: [...required] } : {}),
  };
}

function parseQaHistory(value: unknown): QaHistoryConfig {
  if (value === undefined) return { enabled: false };
  if (!isRecord(value) || typeof value.enabled !== 'boolean') {
    throw new Error('Binaflow config qaHistory.enabled must be a boolean');
  }
  return { enabled: value.enabled };
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
