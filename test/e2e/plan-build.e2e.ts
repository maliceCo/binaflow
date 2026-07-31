import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = join(projectRoot, 'dist', 'src', 'cli', 'index.js');
const e2eEnabled = process.env.BINAFLOW_E2E === '1';
const fixtureInstructions =
  '# E2E Fixture\nOnly create the requested result file. Do not change AGENTS.md.\n';

describe('plan-build E2E', () => {
  it.skipIf(!e2eEnabled)(
    'runs the real CLI against an isolated fixture',
    async () => {
      const plannerModel = process.env.BINAFLOW_E2E_PLANNER_MODEL;
      if (!plannerModel) {
        throw new Error('BINAFLOW_E2E_PLANNER_MODEL is required when BINAFLOW_E2E=1');
      }

      const fixture = await mkdtemp(join(tmpdir(), 'binaflow-e2e-'));
      try {
        const configPath = await createFixture(fixture, plannerModel);
        const objective =
          'Create E2E_RESULT.txt containing exactly the text "binaflow e2e ok" and do not modify any other file.';
        const environment = { ...process.env };

        const run = await runCli(
          fixture,
          environment,
          '--cwd',
          fixture,
          '--config',
          configPath,
          '--verbose',
          'run',
          'plan-build',
          '--objective',
          objective,
        );

        expect(run.stdout).toContain('workflow=plan-build  status=completed');
        expect(run.stdout).toContain('plan  profile=planner');
        expect(run.stdout).toContain('build  profile=builder');
        expect(run.stdout).toContain(`model=${plannerModel}`);
        expect(run.stdout).toContain(
          `build  profile=builder  driver=pi  model=${process.env.BINAFLOW_E2E_BUILDER_MODEL ?? plannerModel}`,
        );
        expect(run.stderr).toContain('[plan] status: Step plan started');
        expect(run.stderr).toContain('[build] status: Step build started');

        const runId = parseRunId(run.stdout);
        const resultPath = join(fixture, 'E2E_RESULT.txt');
        expect((await readFile(resultPath, 'utf8')).trim()).toBe('binaflow e2e ok');
        expect(await readFile(join(fixture, 'AGENTS.md'), 'utf8')).toBe(fixtureInstructions);

        const shown = await runCli(
          fixture,
          environment,
          '--cwd',
          fixture,
          '--config',
          configPath,
          'show',
          runId,
        );
        expect(shown.stdout).toContain('Artifact plan.plan (application/json)');
        expect(shown.stdout).toContain('Artifact build.result (text/plain)');
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    },
    300_000,
  );

  it.skipIf(!e2eEnabled)(
    'resumes after the process is terminated after planning',
    async () => {
      const plannerModel = process.env.BINAFLOW_E2E_PLANNER_MODEL;
      if (!plannerModel) {
        throw new Error('BINAFLOW_E2E_PLANNER_MODEL is required when BINAFLOW_E2E=1');
      }

      const fixture = await mkdtemp(join(tmpdir(), 'binaflow-e2e-resume-'));
      try {
        const configPath = await createFixture(fixture, plannerModel);
        const environment = { ...process.env };
        const objective =
          'Create E2E_RESUME_RESULT.txt containing exactly the text "binaflow resume ok" and do not modify any other file.';
        const interrupted = await terminateAfterPlan(
          fixture,
          environment,
          '--cwd',
          fixture,
          '--config',
          configPath,
          '--verbose',
          'run',
          'plan-build',
          '--objective',
          objective,
        );

        expect(interrupted.stderr).toContain('[plan] status: Step plan completed');
        expect(interrupted.stdout).not.toContain('status=completed');

        const runs = await runCli(
          fixture,
          environment,
          '--cwd',
          fixture,
          '--config',
          configPath,
          'runs',
        );
        const runId = parseActiveRunId(runs.stdout);
        const resumed = await runCli(
          fixture,
          environment,
          '--cwd',
          fixture,
          '--config',
          configPath,
          '--verbose',
          'resume',
          runId,
        );

        expect(resumed.stdout).toContain('workflow=plan-build  status=completed');
        expect(resumed.stdout).toContain('plan  profile=planner  driver=pi');
        expect(resumed.stdout).toContain('build  profile=builder  driver=pi');
        expect(resumed.stderr).not.toContain('[plan] status: Step plan started');
        expect(resumed.stderr).toContain('[build] status: Step build started');
        expect((await readFile(join(fixture, 'E2E_RESUME_RESULT.txt'), 'utf8')).trim()).toBe(
          'binaflow resume ok',
        );
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    },
    300_000,
  );
});

async function createFixture(fixture: string, plannerModel: string): Promise<string> {
  const dataDir = join(fixture, '.binaflow');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(fixture, 'AGENTS.md'), fixtureInstructions, 'utf8');

  const builderModel = process.env.BINAFLOW_E2E_BUILDER_MODEL ?? plannerModel;
  const provider = process.env.BINAFLOW_E2E_PROVIDER;
  const config = {
    dataDir: './.binaflow',
    piCommand: process.env.BINAFLOW_E2E_PI_COMMAND ?? 'pi',
    profiles: {
      planner: {
        driver: 'pi',
        model: plannerModel,
        ...(provider ? { provider } : {}),
        tools: ['ls', 'find', 'read'],
        workspaceMode: 'read-only',
        timeoutMs: 180_000,
        retryLimit: 0,
      },
      builder: {
        driver: 'pi',
        model: builderModel,
        ...(provider ? { provider } : {}),
        tools: ['ls', 'find', 'read', 'write', 'edit', 'bash'],
        workspaceMode: 'read-write',
        timeoutMs: 180_000,
        retryLimit: 0,
      },
    },
  };
  const configPath = join(fixture, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  return configPath;
}

async function runCli(
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function terminateAfterPlan(
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let terminationRequested = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for plan completion:\n${stderr}`));
    }, 180_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (!terminationRequested && stderr.includes('[plan] status: Step plan completed')) {
        terminationRequested = true;
        child.kill('SIGTERM');
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      if (!terminationRequested) {
        reject(new Error(`CLI exited before plan completion:\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseRunId(output: string): string {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith('Run '));
  const runId = line?.match(/^Run (\S+)\s+workflow=plan-build\s+status=completed$/)?.[1];
  if (!runId) throw new Error(`Could not parse completed run ID from output:\n${output}`);
  return runId;
}

function parseActiveRunId(output: string): string {
  const line = output.split(/\r?\n/).find((candidate) => candidate.includes('plan-build'));
  const runId = line?.match(/^(\S+)\s+(?:running|interrupted)\s+plan-build\s+/)?.[1];
  if (!runId) throw new Error(`Could not parse active run ID from output:\n${output}`);
  return runId;
}
