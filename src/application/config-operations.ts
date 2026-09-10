import {
  access,
  link,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  parseConfigValue,
  validateAgentProfile,
  validatePiCommand,
  type AgentProfile,
  type PreparationReviewMode,
} from '../config.js';
import type { AgentModel, AgentModelDiscovery } from '../core/agent.js';
import type { PreparationModel } from './preparation.js';
import { discoverWorkflows } from './workflow-operations.js';

export async function discoverAgentModels(discovery: AgentModelDiscovery): Promise<AgentModel[]> {
  try {
    return await discovery.discoverModels();
  } catch {
    return [];
  }
}

export async function discoverPreparationModels(
  discovery: AgentModelDiscovery,
): Promise<PreparationModel[]> {
  const models = await discoverAgentModels(discovery);
  return models.map((model) => ({ ...model }));
}

export interface ConfigurationDiagnosis {
  workspacePath: string;
  configPath: string;
  configExists: boolean;
  configValid: boolean;
  errors: string[];
  profiles: ProfileDiagnosis[];
  workflows: WorkflowDiagnosis[];
  qaHistory: { enabled: boolean };
  dataDirPath?: string;
  piCommand?: string;
  piCommandLaunchable?: boolean;
  piCommandMessage?: string;
  ready: boolean;
}

export interface ConfigurationDiagnosisOptions {
  probePiCommand?: boolean;
}

export interface WorkspaceEntry {
  path: string;
  name: string;
  isParent: boolean;
  hasBinaflow: boolean;
  error?: string;
}

export function parentWorkspacePath(path: string): string {
  return dirname(path);
}

export function resolveConfigurationPath(configPath: string, cwd = process.cwd()): string {
  return resolve(cwd, configPath);
}

export async function readJsonInput(
  path: string,
  readStdin: () => Promise<string>,
): Promise<Record<string, unknown>> {
  const content = await (path === '-' ? readStdin() : readFile(path, 'utf8'));
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('input JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

export interface TodoFileCandidate {
  path: string;
  relativePath: string;
  sizeBytes: number;
}

export interface TodoFileInput extends TodoFileCandidate {
  content: string;
}

const TODO_FILE_LIMIT = 256 * 1024;
const TODO_SEARCH_LIMIT = 100;
const TODO_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.binaflow',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

export async function discoverTodoFiles(cwd = process.cwd()): Promise<TodoFileCandidate[]> {
  const workspace = await realpath(resolve(cwd));
  const candidates: TodoFileCandidate[] = [];

  async function visit(directory: string): Promise<void> {
    if (candidates.length >= TODO_SEARCH_LIMIT) return;
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (candidates.length >= TODO_SEARCH_LIMIT) return;
      if (entry.isDirectory()) {
        if (!TODO_IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(resolve(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !/^todo(?:-.*)?\.md$/i.test(entry.name)) continue;
      const path = resolve(directory, entry.name);
      const details = await stat(path);
      if (details.size > TODO_FILE_LIMIT) continue;
      candidates.push({ path, relativePath: relative(workspace, path), sizeBytes: details.size });
    }
  }

  await visit(workspace);
  return candidates.sort((left, right) => {
    if (left.relativePath === 'TODO.md') return -1;
    if (right.relativePath === 'TODO.md') return 1;
    return left.relativePath.localeCompare(right.relativePath);
  });
}

export async function readTodoFile(path: string, cwd = process.cwd()): Promise<TodoFileInput> {
  const workspace = await realpath(resolve(cwd));
  const requested = isAbsolute(path) ? path : resolve(workspace, path);
  const actual = await realpath(requested);
  const relativePath = relative(workspace, actual);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('TODO file must be inside the selected workspace');
  }
  const content = await readFile(actual, 'utf8');
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > TODO_FILE_LIMIT) {
    throw new Error(`TODO file exceeds the ${TODO_FILE_LIMIT}-byte limit`);
  }
  if (!content.trim()) throw new Error('TODO file must be non-empty');
  return { path: actual, relativePath, sizeBytes, content };
}

export async function listWorkspaceEntries(path: string): Promise<WorkspaceEntry[]> {
  const dirents = await readdir(path, { withFileTypes: true });
  const directories = dirents
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const entries: WorkspaceEntry[] =
    parse(path).root === path
      ? []
      : [{ path: parentWorkspacePath(path), name: '..', isParent: true, hasBinaflow: false }];
  const childEntries = await Promise.all(
    directories.map(async (entry) => {
      const full = resolve(path, entry.name);
      let hasBinaflow = false;
      try {
        hasBinaflow = await configurationExists('.binaflow/config.json', full);
      } catch {
        hasBinaflow = false;
      }
      return { path: full, name: entry.name, isParent: false, hasBinaflow };
    }),
  );
  return [...entries, ...childEntries];
}

export interface ProfileDiagnosis {
  name: string;
  valid: boolean;
  errors: string[];
  settings?: AgentProfile;
}

export interface WorkflowDiagnosis {
  id: string;
  description: string;
  experimental?: boolean;
  requiredProfiles: string[];
  missingProfiles: string[];
  available: boolean;
}

export async function diagnoseConfigurationFile(
  configPath: string,
  cwd = process.cwd(),
  options: ConfigurationDiagnosisOptions = {},
): Promise<ConfigurationDiagnosis> {
  const workspacePath = resolve(cwd);
  const absoluteConfigPath = resolve(workspacePath, configPath);
  const workflows = workflowDiagnoses(new Set());
  let content: string;
  try {
    content = await readFile(absoluteConfigPath, 'utf8');
  } catch (error) {
    const exists = error instanceof Error && 'code' in error && error.code !== 'ENOENT';
    return {
      workspacePath,
      configPath: absoluteConfigPath,
      configExists: exists,
      configValid: false,
      errors: [
        `Cannot read Binaflow config ${absoluteConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      profiles: [],
      workflows,
      qaHistory: { enabled: false },
      ready: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      workspacePath,
      configPath: absoluteConfigPath,
      configExists: true,
      configValid: false,
      errors: [
        `Configuration JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
      profiles: [],
      workflows,
      qaHistory: { enabled: false },
      ready: false,
    };
  }

  const errors: string[] = [];
  const record = asRecord(parsed);
  const qaHistory = diagnoseQaHistory(record?.qaHistory, errors);
  if (!record) {
    errors.push('Binaflow config must be a JSON object');
  }

  const profiles: ProfileDiagnosis[] = [];
  const validProfileNames = new Set<string>();
  const profileRecord = record ? asRecord(record.profiles) : undefined;
  if (!profileRecord) {
    errors.push('Binaflow config requires a profiles object');
  } else {
    for (const [name, value] of Object.entries(profileRecord)) {
      const validation = validateAgentProfile(name, value, absoluteConfigPath);
      profiles.push({
        name,
        valid: validation.errors.length === 0,
        errors: validation.errors,
        ...(validation.profile ? { settings: validation.profile } : {}),
      });
      if (validation.errors.length === 0) validProfileNames.add(name);
    }
  }

  const dataDirValue = record?.dataDir;
  if (dataDirValue !== undefined && typeof dataDirValue !== 'string') {
    errors.push('Binaflow config dataDir must be a string');
  }
  const dataDirPath =
    typeof dataDirValue === 'string'
      ? resolve(dirname(absoluteConfigPath), dataDirValue)
      : resolve(dirname(absoluteConfigPath), './data');

  const piCommandValue = record?.piCommand;
  errors.push(...validatePiCommand(piCommandValue).map((error) => `Binaflow config ${error}`));
  const piCommand = typeof piCommandValue === 'string' ? piCommandValue : 'pi';
  const workflowsWithProfiles = workflowDiagnoses(validProfileNames);
  const configValid = errors.length === 0 && profiles.every((profile) => profile.valid);
  const launch =
    configValid && options.probePiCommand
      ? await canLaunchCommand(piCommand, workspacePath)
      : undefined;
  const ready =
    configValid &&
    workflowsWithProfiles
      .filter((workflow) => workflow.experimental !== true)
      .every((workflow) => workflow.available) &&
    (options.probePiCommand ? launch?.launchable === true : true);

  return {
    workspacePath,
    configPath: absoluteConfigPath,
    configExists: true,
    configValid,
    errors,
    profiles,
    workflows: workflowsWithProfiles,
    qaHistory,
    dataDirPath,
    piCommand,
    ...(launch ? { piCommandLaunchable: launch.launchable, piCommandMessage: launch.message } : {}),
    ready,
  };
}

export type ConfigurableProfileName = 'analyst' | 'planner' | 'qa' | 'builder';

export interface ConfigurationProfileInput {
  provider: string;
  model: string;
  thinking?: string;
  writeAccess?: boolean;
}

export interface ConfigurationGenerationInput {
  configPath: string;
  cwd?: string;
  plannerProvider?: string;
  plannerModel?: string;
  builderProvider?: string;
  builderModel?: string;
  builderWriteAccess?: boolean;
  profileSettings?: Partial<Record<ConfigurableProfileName, ConfigurationProfileInput>>;
}

export type ConfigurationDocument = Record<string, unknown> & {
  dataDir: string;
  piCommand: string;
  profiles: Record<string, AgentProfile>;
  preparation?: { reviewMode?: PreparationReviewMode };
};

export interface GeneratedConfiguration {
  configPath: string;
  config: ConfigurationDocument;
  sourceHash?: string;
}

export interface PreparationConfigurationGenerationInput {
  configPath: string;
  cwd?: string;
  reviewMode: PreparationReviewMode;
}

function legacyProfileSettings(
  input: ConfigurationGenerationInput,
): Record<ConfigurableProfileName, ConfigurationProfileInput> {
  return {
    analyst: {
      provider: input.plannerProvider ?? '',
      model: input.plannerModel ?? '',
    },
    planner: {
      provider: input.plannerProvider ?? '',
      model: input.plannerModel ?? '',
    },
    qa: {
      provider: input.plannerProvider ?? '',
      model: input.plannerModel ?? '',
    },
    builder: {
      provider: input.builderProvider ?? '',
      model: input.builderModel ?? '',
      writeAccess: input.builderWriteAccess === true,
    },
  };
}

function profileDocuments(
  settings: Partial<Record<ConfigurableProfileName, ConfigurationProfileInput>>,
): Record<string, AgentProfile> {
  return Object.fromEntries(
    Object.entries(settings).map(([name, value]) => {
      if (!value) throw new Error(`${name} profile settings are required.`);
      const writeAccess = name === 'builder' && value.writeAccess === true;
      const profile: AgentProfile = {
        driver: 'pi',
        provider: value.provider.trim(),
        model: value.model.trim(),
        ...(value.thinking && value.thinking.trim().toLowerCase() !== 'default'
          ? { thinking: value.thinking.trim() }
          : {}),
        tools: writeAccess
          ? ['ls', 'find', 'read', 'write', 'edit', 'bash']
          : ['ls', 'find', 'read'],
        workspaceMode: writeAccess ? 'read-write' : 'read-only',
        projectTrust: writeAccess ? 'always' : 'never',
        skills: { mode: 'discover' },
        timeoutMs: 180_000,
        retryLimit: 0,
      };
      return [name, profile];
    }),
  );
}

export function generateConfiguration(input: ConfigurationGenerationInput): GeneratedConfiguration {
  const configPath = resolve(input.cwd ?? process.cwd(), input.configPath);
  const profileSettings = input.profileSettings ?? legacyProfileSettings(input);
  const config: ConfigurationDocument = {
    dataDir: './data',
    piCommand: 'pi',
    qaHistory: { enabled: false },
    profiles: profileDocuments(profileSettings),
  };
  parseConfigValue(config, configPath);
  return { configPath, config };
}

export async function generateUpdatedConfiguration(
  input: ConfigurationGenerationInput,
): Promise<GeneratedConfiguration> {
  const current = await readConfigurationDocument(
    resolve(input.cwd ?? process.cwd(), input.configPath),
  );
  if (!input.profileSettings) {
    const generated = generateConfiguration(input);
    const config: ConfigurationDocument = { ...current, profiles: generated.config.profiles };
    parseConfigValue(config, generated.configPath);
    return { configPath: generated.configPath, config };
  }
  const configPath = resolve(input.cwd ?? process.cwd(), input.configPath);
  const config: ConfigurationDocument = {
    ...current,
    profiles: {
      ...current.profiles,
      ...profileDocuments(input.profileSettings),
    },
  };
  parseConfigValue(config, configPath);
  return { configPath, config };
}

export async function generateUpdatedPreparationConfiguration(
  input: PreparationConfigurationGenerationInput,
): Promise<GeneratedConfiguration> {
  if (
    input.reviewMode !== 'human' &&
    input.reviewMode !== 'optional-auto' &&
    input.reviewMode !== 'required-auto'
  ) {
    throw new Error('Invalid preparation review mode');
  }
  const configPath = resolve(input.cwd ?? process.cwd(), input.configPath);
  const current = await readConfigurationDocument(configPath);
  const sourceHash = await configurationSourceHash(configPath);
  const config: ConfigurationDocument = {
    ...current,
    preparation: {
      ...(asRecord(current.preparation) ?? {}),
      reviewMode: input.reviewMode,
    },
  };
  parseConfigValue(config, configPath);
  return { configPath, config, sourceHash };
}

export async function writeConfigurationAtomically(
  generated: GeneratedConfiguration,
): Promise<void> {
  parseConfigValue(generated.config, generated.configPath);
  await mkdir(dirname(generated.configPath), { recursive: true });
  const temporaryPath = `${generated.configPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(generated.config, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    try {
      await link(temporaryPath, generated.configPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw new Error(`Binaflow config already exists: ${generated.configPath}`);
      }
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function replaceConfigurationAtomically(
  generated: GeneratedConfiguration,
): Promise<void> {
  parseConfigValue(generated.config, generated.configPath);
  if (generated.sourceHash !== undefined) {
    const currentHash = await configurationSourceHash(generated.configPath);
    if (currentHash !== generated.sourceHash) {
      throw new Error('Binaflow config changed since the preparation preview; confirm again');
    }
  }
  await mkdir(dirname(generated.configPath), { recursive: true });
  const temporaryPath = `${generated.configPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(generated.config, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, generated.configPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function configurationExists(
  configPath: string,
  cwd = process.cwd(),
): Promise<boolean> {
  try {
    await access(resolve(cwd, configPath));
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readConfigurationDocument(path: string): Promise<ConfigurationDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot read Binaflow config ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!asRecord(parsed)) throw new Error('Binaflow config must be a JSON object');
  return parsed as ConfigurationDocument;
}

async function configurationSourceHash(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

function diagnoseQaHistory(value: unknown, errors: string[]): { enabled: boolean } {
  if (value === undefined) return { enabled: false };
  const record = asRecord(value);
  if (!record || typeof record.enabled !== 'boolean') {
    errors.push('Binaflow config qaHistory.enabled must be a boolean');
    return { enabled: false };
  }
  return { enabled: record.enabled };
}

function workflowDiagnoses(configuredProfiles: Set<string>): WorkflowDiagnosis[] {
  return discoverWorkflows().map((workflow) => {
    const missingProfiles = workflow.requiredProfiles.filter(
      (profile) => !configuredProfiles.has(profile),
    );
    return {
      id: workflow.id,
      description: workflow.description,
      ...(workflow.experimental ? { experimental: true } : {}),
      requiredProfiles: workflow.requiredProfiles,
      missingProfiles,
      available: missingProfiles.length === 0,
    };
  });
}

export async function canLaunchCommand(
  command: string,
  cwd: string,
  args = ['--version'],
): Promise<{ launchable: boolean; message: string }> {
  return new Promise((resolveResult) => {
    let child: ChildProcess | undefined;
    let launched = false;
    let timedOut = false;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    try {
      child = spawn(command, args, { cwd, stdio: 'ignore', windowsHide: true });
    } catch (error) {
      resolveResult({
        launchable: false,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const finish = (result: { launchable: boolean; message: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolveResult(result);
    };

    child.once('spawn', () => {
      launched = true;
    });
    child.once('error', (error) => {
      if (!launched) finish({ launchable: false, message: error.message });
    });
    child.once('close', (code, signal) =>
      finish({
        launchable: launched && code === 0 && signal === null,
        message: timedOut
          ? 'command timed out'
          : !launched
            ? 'command did not start'
            : signal
              ? `command exited due to signal ${signal}`
              : `command exited with code ${code ?? 'unknown'}`,
      }),
    );
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child?.kill();
      } catch {
        // The child may have exited between the timeout and kill attempt.
      }
      forceKillTimer = setTimeout(() => {
        if (child?.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // The close event remains the authoritative reap signal.
          }
        }
      }, 1_000);
    }, 2_000);
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
