import { test, expect } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = resolve('dist/src/cli/index.js');
const fakePiPath = resolve('test/web/local-fake-pi.mjs');

test('accepts the complete local launcher workflow in one computer', async ({ page }) => {
  const fixture = await startLocalLauncher();
  try {
    await page.goto(fixture.url);
    await page.getByLabel('Access code').fill(fixture.accessCode);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Set up Binaflow' })).toBeVisible();

    await page.getByRole('button', { name: 'Authorize' }).first().click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    await page.getByRole('button', { name: 'projects', exact: true }).click();
    const taskRefresh = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/tasks') && response.status() === 200,
    );
    await page.getByRole('button', { name: /sample \(Binaflow project\)/ }).click();
    await taskRefresh;
    await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
    await expect(page.getByText('No tasks yet.')).toBeVisible();

    await page.getByLabel('Objective').fill('Prepare a deterministic local task');
    await expect(page.getByLabel('Objective')).toHaveValue('Prepare a deterministic local task');
    await expect(page.getByRole('button', { name: 'Create task' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('heading', { name: /Task / })).toBeVisible();

    await page.getByLabel('Message').fill('What is in scope for this task?');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Fixture response')).toBeVisible();

    await page.getByRole('button', { name: 'Confirm brief' }).click();
    await expect(page.getByText(/Preparation revision \d+\./)).toBeVisible();
    await page.getByRole('button', { name: 'Generate plan' }).click();
    await expect(page.getByText('Plan version 1 is available.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve plan' }).click();
    await expect(page.getByRole('button', { name: 'Generate TODO' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate TODO' }).click();
    await expect(page.getByRole('button', { name: 'Preview execution' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview execution' }).click();
    await expect(page.getByText(/Preview digest:/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and start execution' }).click();
    await expect(page.getByText('Execution is waiting for changes review.')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Server settings' }).click();
    const revokeResponse = page.waitForResponse((response) =>
      response.url().includes('/api/v1/project-roots/'),
    );
    await page.getByRole('button', { name: 'Remove authorization' }).click();
    const response = await revokeResponse;
    expect(response.status()).toBe(200);
    await expect(
      page.getByText('Folder authorization removed. Registered projects and files were kept.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
  } finally {
    await page.close();
    await fixture.close();
  }
});

async function startLocalLauncher(): Promise<{
  url: string;
  accessCode: string;
  close(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'binaflow-local-launcher-'));
  const configHome = join(root, 'config-home');
  const projects = join(root, 'projects');
  const workspace = join(projects, 'sample');
  const fakePiLauncher = join(root, 'fake-pi');
  await writeFile(fakePiLauncher, `#!/usr/bin/env node\nimport '${fakePiPath}';\n`, {
    mode: 0o755,
  });
  await mkdir(join(workspace, '.binaflow'), { recursive: true });
  await mkdir(configHome, { recursive: true });
  await writeFile(join(workspace, '.binaflow', '.gitignore'), 'data/\n');
  await writeFile(
    join(workspace, '.binaflow', 'config.json'),
    JSON.stringify({
      dataDir: './data',
      piCommand: fakePiLauncher,
      profiles: {
        planner: {
          driver: 'pi',
          model: 'fixture',
          tools: [],
          workspaceMode: 'read-only',
          projectTrust: 'never',
          skills: { mode: 'none' },
          timeoutMs: 10_000,
          retryLimit: 0,
        },
        builder: {
          driver: 'pi',
          model: 'fixture',
          tools: [],
          workspaceMode: 'read-write',
          projectTrust: 'never',
          skills: { mode: 'none' },
          timeoutMs: 10_000,
          retryLimit: 0,
        },
      },
    }),
  );
  await writeFile(join(workspace, 'README.md'), 'fixture\n');
  await execFileAsync('git', ['init', '-q'], { cwd: workspace });
  await execFileAsync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: workspace });
  await execFileAsync('git', ['config', 'user.name', 'Binaflow Fixture'], { cwd: workspace });
  await execFileAsync('git', ['add', '.'], { cwd: workspace });
  await execFileAsync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  const port = await freePort();
  const settingsDirectory = join(configHome, 'binaflow');
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(
    join(settingsDirectory, 'web.json'),
    JSON.stringify({
      schemaVersion: 1,
      setupRequired: true,
      deviceName: 'Fixture',
      web: { host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}` },
      projectRoots: [],
    }),
  );
  const child = spawn(process.execPath, [cliPath, 'web'], {
    cwd: root,
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: configHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => process.stderr.write(`[fixture] ${chunk}`));
  const output = await readUntil(child, /Binaflow access code: ([a-f0-9]{64})/);
  const match = output.match(/Binaflow access code: ([a-f0-9]{64})/);
  if (!match) throw new Error(`Launcher did not start:\n${output}`);
  return {
    url: `http://127.0.0.1:${port}`,
    accessCode: match[1]!,
    close: async () => {
      const exited = new Promise<void>((resolveClose) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolveClose();
          return;
        }
        child.once('exit', () => resolveClose());
      });
      child.kill('SIGTERM');
      await Promise.race([
        exited,
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function readUntil(child: ChildProcess, pattern: RegExp): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (pattern.test(output)) {
        child.stderr?.off('data', onData);
        resolveOutput(output);
      }
    };
    child.stderr?.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Launcher exited with ${code}: ${output}`)));
  });
}

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}
