import { access, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  parseConfigValue,
  validateAgentProfile,
  validatePiCommand,
  type AgentProfile,
} from '../config.js';
import type { AgentModel, AgentModelDiscovery } from '../core/agent.js';
import { discoverWorkflows } from './operations.js';

export async function discoverAgentModels(discovery: AgentModelDiscovery): Promise<AgentModel[]> {
  try {
    return await discovery.discoverModels();
  } catch {
    return [];
  }
}

export interface ConfigurationDiagnosis {
  workspacePath: string;
  configPath: string;
  configExists: boolean;
  configValid: boolean;
  errors: string[];
  profiles: ProfileDiagnosis[];
  workflows: WorkflowDiagnosis[];
  dataDirPath?: string;
  piCommand?: string;
  piCommandLaunchable?: boolean;
  piCommandMessage?: string;
  ready: boolean;
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
      ready: false,
    };
  }

  const errors: string[] = [];
  const record = asRecord(parsed);
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
      const validation = validateAgentProfile(name, value);
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
  const launch = configValid ? await canLaunchCommand(piCommand, workspacePath) : undefined;
  const ready =
    configValid &&
    workflowsWithProfiles
      .filter((workflow) => workflow.experimental !== true)
      .every((workflow) => workflow.available) &&
    launch?.launchable === true;

  return {
    workspacePath,
    configPath: absoluteConfigPath,
    configExists: true,
    configValid,
    errors,
    profiles,
    workflows: workflowsWithProfiles,
    dataDirPath,
    piCommand,
    ...(launch ? { piCommandLaunchable: launch.launchable, piCommandMessage: launch.message } : {}),
    ready,
  };
}

export interface ConfigurationGenerationInput {
  configPath: string;
  cwd?: string;
  plannerProvider: string;
  plannerModel: string;
  builderProvider: string;
  builderModel: string;
  builderWriteAccess: boolean;
}

export interface GeneratedConfiguration {
  configPath: string;
  config: {
    dataDir: string;
    piCommand: string;
    profiles: Record<string, AgentProfile>;
  };
}

export function generateConfiguration(input: ConfigurationGenerationInput): GeneratedConfiguration {
  const configPath = resolve(input.cwd ?? process.cwd(), input.configPath);
  const builderTools = input.builderWriteAccess
    ? ['ls', 'find', 'read', 'write', 'edit', 'bash']
    : ['ls', 'find', 'read'];
  const config = {
    dataDir: './data',
    piCommand: 'pi',
    profiles: {
      planner: {
        driver: 'pi',
        provider: input.plannerProvider.trim(),
        model: input.plannerModel.trim(),
        tools: ['ls', 'find', 'read'],
        workspaceMode: 'read-only' as const,
        projectTrust: 'never' as const,
        timeoutMs: 180_000,
        retryLimit: 0,
      },
      builder: {
        driver: 'pi',
        provider: input.builderProvider.trim(),
        model: input.builderModel.trim(),
        tools: builderTools,
        workspaceMode: input.builderWriteAccess ? ('read-write' as const) : ('read-only' as const),
        projectTrust: input.builderWriteAccess ? ('always' as const) : ('never' as const),
        timeoutMs: 180_000,
        retryLimit: 0,
      },
    },
  };
  parseConfigValue(config, configPath);
  return { configPath, config };
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
