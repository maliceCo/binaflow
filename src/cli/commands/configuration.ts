import type { Command } from 'commander';
import { resolve } from 'node:path';
import {
  cliUsageError,
  machineMode,
  rejectUnsupportedJsonl,
  writeJsonResult,
} from '../protocol.js';
import type { ConfigurationDiagnosis } from '../../application/config-operations.js';

interface RootOptions {
  config?: string;
  cwd?: string;
  json?: boolean;
  jsonl?: boolean;
}

interface InitAnswers {
  plannerProvider: string;
  plannerModel: string;
  builderProvider: string;
  builderModel: string;
  builderWriteAccess: boolean;
}

interface PromptReader {
  question(prompt: string): Promise<string>;
  close(): void;
}

interface InitPromptSession {
  answers: InitAnswers;
  confirm(prompt: string): Promise<boolean>;
  close(): void;
}

export function registerConfigurationCommands(cli: Command): void {
  cli
    .command('doctor')
    .description('Diagnose workspace configuration and workflow readiness')
    .action(async (_options: unknown, command: Command) => {
      const options = rootOptions(command);
      const mode = machineMode(options);
      rejectUnsupportedJsonl(mode, 'doctor');
      const { diagnoseConfigurationFile } = await import('../../application/config-operations.js');
      const diagnosis = await diagnoseConfigurationFile(
        options.config ?? '.binaflow/config.json',
        options.cwd,
      );
      if (mode === 'json') {
        writeJsonResult('doctor', diagnosis);
      } else {
        printDiagnosis(diagnosis);
      }
      if (!diagnosis.ready) process.exitCode = 1;
    });

  cli
    .command('init')
    .description('Create a workspace configuration interactively')
    .action(async (_options: unknown, command: Command) => {
      const { configurationExists, generateConfiguration, writeConfigurationAtomically } =
        await import('../../application/config-operations.js');
      const options = rootOptions(command);
      if (machineMode(options)) {
        throw cliUsageError(
          'INTERACTIVE_REQUIRES_HUMAN_MODE',
          'The init command is interactive and cannot be combined with --json or --jsonl',
        );
      }
      const configPath = options.config ?? '.binaflow/config.json';
      if (await configurationExists(configPath, options.cwd)) {
        throw cliUsageError(
          'CONFIG_EXISTS',
          `Binaflow config already exists at ${configurationPath(configPath, options.cwd)}; refusing to overwrite it`,
        );
      }

      const session = await promptForConfiguration();
      try {
        let generated;
        try {
          generated = generateConfiguration({
            configPath,
            ...(options.cwd ? { cwd: options.cwd } : {}),
            ...session.answers,
          });
        } catch (error) {
          throw cliUsageError(
            'INVALID_CONFIGURATION',
            error instanceof Error ? error.message : String(error),
          );
        }

        console.log(`Configuration target: ${generated.configPath}`);
        console.log(JSON.stringify(generated.config, null, 2));
        const confirmed = await session.confirm('Write this configuration? (y/N): ');
        if (!confirmed) {
          console.log('Configuration creation cancelled.');
          return;
        }

        await writeConfigurationAtomically(generated);
        console.log(`Configuration written to ${generated.configPath}`);
      } finally {
        session.close();
      }
    });
}

async function promptForConfiguration(): Promise<InitPromptSession> {
  const readline = await createLineReader();
  try {
    console.log(
      'Binaflow setup asks for provider and model names only. It never stores credentials.',
    );
    const plannerProvider = await promptRequired(readline, 'Planner provider: ');
    const plannerModel = await promptRequired(readline, 'Planner model: ');
    const builderProvider = await promptRequired(readline, 'Builder provider: ');
    const builderModel = await promptRequired(readline, 'Builder model: ');
    console.log(
      'The builder can be read-only, or can write/edit files and run shell commands in the workspace.',
    );
    const builderWriteAccess = await promptConfirmation(
      'Enable builder write, edit, shell, and project-trust access? (y/N): ',
      readline,
    );
    const answers = {
      plannerProvider,
      plannerModel,
      builderProvider,
      builderModel,
      builderWriteAccess,
    };
    return {
      answers,
      confirm: (prompt) => promptConfirmation(prompt, readline),
      close: () => readline.close(),
    };
  } catch (error) {
    readline.close();
    throw error;
  }
}

async function createLineReader(): Promise<PromptReader> {
  const { createInterface } = await import('node:readline');
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  return {
    async question(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      const line = await lines.next();
      if (line.done) throw new Error('Configuration input cancelled');
      return line.value;
    },
    close(): void {
      input.close();
    },
  };
}

async function promptRequired(
  readline: Pick<PromptReader, 'question'>,
  prompt: string,
): Promise<string> {
  while (true) {
    const value = (await readline.question(prompt)).trim();
    if (value) return value;
    console.log('A non-empty value is required.');
  }
}

async function promptConfirmation(
  prompt: string,
  existingReadline?: PromptReader,
): Promise<boolean> {
  const readline =
    existingReadline ??
    (await import('node:readline/promises')).createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  try {
    const answer = (await readline.question(prompt)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    if (!existingReadline) readline.close();
  }
}

function printDiagnosis(diagnosis: ConfigurationDiagnosis): void {
  console.log(`Workspace: ${diagnosis.workspacePath}`);
  console.log(`Config: ${diagnosis.configPath}`);
  console.log(`Config valid: ${diagnosis.configValid ? 'yes' : 'no'}`);
  if (diagnosis.dataDirPath) console.log(`Data directory: ${diagnosis.dataDirPath}`);
  if (diagnosis.piCommand) {
    const launchable =
      diagnosis.piCommandLaunchable === undefined
        ? 'not checked'
        : diagnosis.piCommandLaunchable
          ? 'yes'
          : 'no';
    console.log(`Pi command: ${diagnosis.piCommand}  launchable=${launchable}`);
    if (diagnosis.piCommandMessage) console.log(`  Pi probe: ${diagnosis.piCommandMessage}`);
    else if (diagnosis.piCommandLaunchable === undefined) console.log('  Pi probe: not checked.');
    console.log('  Authentication and model availability are not checked by doctor.');
  } else {
    console.log('Pi probe: not checked.');
  }
  for (const error of diagnosis.errors) console.log(`Error: ${error}`);
  for (const profile of diagnosis.profiles) {
    console.log(`Profile ${profile.name}: ${profile.valid ? 'valid' : 'invalid'}`);
    for (const error of profile.errors) console.log(`  Error: ${error}`);
    if (profile.settings) {
      console.log(
        `  driver=${profile.settings.driver} provider=${profile.settings.provider ?? '-'} model=${profile.settings.model}`,
      );
      console.log(
        `  tools=${profile.settings.tools.join(',')} workspace=${profile.settings.workspaceMode} trust=${profile.settings.projectTrust ?? '-'} timeoutMs=${profile.settings.timeoutMs} retryLimit=${profile.settings.retryLimit}`,
      );
    }
  }
  for (const workflow of diagnosis.workflows) {
    const label = workflow.experimental ? ' [experimental]' : '';
    console.log(
      `Workflow ${workflow.id}${label}: ${workflow.available ? 'available' : `missing profiles: ${workflow.missingProfiles.join(', ')}`}`,
    );
  }
  console.log(`Ready: ${diagnosis.ready ? 'yes' : 'no'}`);
}

function configurationPath(configPath: string, cwd = process.cwd()): string {
  return resolve(cwd, configPath);
}

function rootOptions(command: Command): RootOptions {
  let root = command;
  while (root.parent) root = root.parent;
  return root.opts<RootOptions>();
}
