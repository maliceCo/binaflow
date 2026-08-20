import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as configOperations from '../src/application/config-operations.js';
import { runInkShell } from '../src/tui/shell.js';
import type { ConfigurationDiagnosis } from '../src/application/config-operations.js';
import type { ApplicationService } from '../src/application/service.js';
import type { AgentProfile } from '../src/config.js';
import type { WorkflowEngine } from '../src/core/engine.js';
import type { NormalizedEvent } from '../src/core/events.js';
import type { WorkflowRun } from '../src/core/run.js';

describe('Ink shell', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('navigates the welcome screen, studio overlays, and exit without legacy rendering', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await waitForHomeReady(terminal);
    terminal.input.push('?');
    await terminal.output.waitFor('Keyboard');
    terminal.input.push('q');
    await terminal.output.waitFor('Configuration readiness');
    terminal.input.push('d');
    await terminal.output.waitFor('Diagnosis');
    terminal.input.push('w');
    await terminal.output.waitFor('Choose a folder');
    terminal.input.push('q');
    await terminal.output.waitFor('Configuration readiness');
    terminal.input.push('q');
    await running;

    expect(terminal.output.text()).not.toContain('\u001b[36m');
    expect(terminal.output.text()).toContain('\u001b[?1049l');
  });

  it('ignores an in-flight diagnosis result after unmount', async () => {
    const directory = await temporaryDirectory();
    const terminal = createTerminal();
    let calls = 0;
    let release: (value: ConfigurationDiagnosis) => void = () => undefined;
    const diagnosis = new Promise<ConfigurationDiagnosis>((resolve) => {
      release = resolve;
    });
    const result = createDiagnosis(directory);
    vi.spyOn(configOperations, 'diagnoseConfigurationFile').mockImplementation(async () => {
      calls += 1;
      return diagnosis;
    });

    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });
    await terminal.output.waitFor('BINAFLOW');
    await terminal.input.waitUntilReady();
    expect(calls).toBe(1);
    terminal.input.push('q');
    release(result);
    await running;
    await new Promise((resolve) => setImmediate(resolve));
    expect(terminal.output.text()).toContain('BINAFLOW');
  });

  it('keeps an attached run live through activity, cancellation, and completion', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const terminal = createTerminal();
    let emitEvent: ((event: NormalizedEvent) => void) | undefined;
    let resolveExecution: ((run: WorkflowRun) => void) | undefined;
    const execute = vi.fn(
      async (
        _workflow: unknown,
        request: { signal?: AbortSignal; onRunStarted?: (run: WorkflowRun) => void },
      ) => {
        const running = createRun('running');
        request.onRunStarted?.(running);
        const result = new Promise<WorkflowRun>((resolve) => {
          resolveExecution = resolve;
        });
        request.signal?.addEventListener('abort', () => {
          setTimeout(() => resolveExecution?.(createRun('cancelled')), 100);
        });
        return result;
      },
    );
    const context = createApplicationService(execute, (listener) => {
      emitEvent = listener;
    });
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await launchWorkflow(terminal);
    emitEvent?.({
      runId: 'run-1',
      stepId: 'plan',
      type: 'text',
      message: '\u001b[31magent output\u001b[0m',
      occurredAt: new Date().toISOString(),
    });
    await terminal.output.waitFor('agent output');
    terminal.input.push('q');
    await terminal.output.waitFor('Cancellation requested');
    await terminal.output.waitFor('Run status');
    expect(execute).toHaveBeenCalledTimes(1);
    terminal.input.push('q');
    await terminal.output.waitFor('Press n to start a run.');
    terminal.input.push('q');
    await running;
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)(
    'cancels safely when %s arrives while context startup is pending',
    async (signal, exitCode) => {
      const directory = await temporaryDirectory();
      await writeConfig(directory);
      const terminal = createTerminal();
      let releaseContext: ((context: ApplicationService & { close(): void }) => void) | undefined;
      let contextRequested = false;
      let closed = false;
      const context = createApplicationService(
        vi.fn(async () => createRun('completed')),
        () => undefined,
      );
      const ownedContext = { ...context, close: () => (closed = true) };
      const opening = new Promise<ApplicationService & { close(): void }>((resolve) => {
        releaseContext = resolve;
      });
      const previousExitCode = process.exitCode;
      try {
        process.exitCode = undefined;
        const running = runInkShell({
          cwd: directory,
          input: terminal.input as unknown as NodeJS.ReadStream,
          output: terminal.output as unknown as NodeJS.WriteStream,
          errorOutput: terminal.output as unknown as NodeJS.WriteStream,
          env: { NO_COLOR: '' },
          openApplicationContext: async () => {
            contextRequested = true;
            return opening;
          },
        });
        await launchWorkflow(terminal, false);
        await waitForCondition(() => contextRequested);
        terminal.input.push('\r');
        await waitForCondition(() => contextRequested);
        process.emit(signal);
        releaseContext?.(ownedContext);
        await running;

        expect(process.exitCode).toBe(exitCode);
        expect(closed).toBe(true);
      } finally {
        process.exitCode = previousExitCode;
      }
    },
    10_000,
  );

  it.each(['input', 'output'] as const)(
    'unsubscribes and settles active work before closing an owned context after an %s stream failure',
    async (stream) => {
      const directory = await temporaryDirectory();
      await writeConfig(directory);
      const terminal = createTerminal();
      const order: string[] = [];
      let resolveExecution: ((run: WorkflowRun) => void) | undefined;
      const execution = new Promise<WorkflowRun>((resolve) => {
        resolveExecution = resolve;
      });
      const context = createApplicationService(
        async (_workflow, request) => {
          request.onRunStarted?.(createRun('running'));
          request.signal?.addEventListener('abort', () => order.push('aborted'));
          const run = await execution;
          order.push('settled');
          return run;
        },
        () => undefined,
      );
      const ownedContext = {
        ...context,
        close: () => order.push('closed'),
        subscribeEvents: () => () => order.push('unsubscribed'),
      };
      const running = runInkShell({
        cwd: directory,
        input: terminal.input as unknown as NodeJS.ReadStream,
        output: terminal.output as unknown as NodeJS.WriteStream,
        errorOutput: terminal.output as unknown as NodeJS.WriteStream,
        env: { NO_COLOR: '' },
        openApplicationContext: async () => ownedContext,
      });
      await launchWorkflow(terminal);
      // Drop setup/open ordering (recent-runs ensureContext + replaceOwnedContext).
      order.length = 0;
      if (stream === 'input') terminal.input.emit('error', new Error('input failed'));
      else terminal.output.emit('error', new Error('output failed'));
      await new Promise((resolve) => setImmediate(resolve));

      expect(order).toContain('aborted');
      expect(order).toContain('unsubscribed');
      expect(order).not.toContain('closed');
      resolveExecution?.(createRun('cancelled'));
      await expect(running).rejects.toThrow(`${stream} failed`);
      expect(order).toEqual(['unsubscribed', 'aborted', 'settled', 'closed']);
    },
  );

  it('restores the terminal before force signalling and leaves no active work after exit', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const terminal = createTerminal();
    let resolveExecution: ((run: WorkflowRun) => void) | undefined;
    let closed = false;
    const execution = new Promise<WorkflowRun>((resolve) => {
      resolveExecution = resolve;
    });
    const context = createApplicationService(
      async (_workflow, request) => {
        request.onRunStarted?.(createRun('running'));
        request.signal?.addEventListener('abort', () => {
          setTimeout(() => resolveExecution?.(createRun('cancelled')), 50);
        });
        return execution;
      },
      () => undefined,
    );
    const forceExit = vi.fn(() => {
      expect(terminal.input.rawMode).toEqual([true, false]);
      expect(terminal.output.text()).toContain('\u001b[?1049l');
      resolveExecution?.(createRun('cancelled'));
    });
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      openApplicationContext: async () => ({ ...context, close: () => (closed = true) }),
      forceExit,
    });
    await launchWorkflow(terminal);
    terminal.input.push('q');
    await terminal.output.waitFor('Cancellation requested');
    terminal.input.push('q');
    await running;

    expect(forceExit).toHaveBeenCalledWith('SIGINT');
    expect(closed).toBe(true);
  });

  it('keeps the footer visible and redraws the shell after resize', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await waitForHomeReady(terminal);
    terminal.output.columns = 40;
    terminal.output.rows = 8;
    terminal.output.emit('resize');
    await terminal.output.waitFor('Terminal too small');
    terminal.output.columns = 80;
    terminal.output.rows = 24;
    terminal.output.emit('resize');
    await terminal.input.waitUntilReady();
    terminal.input.push('q');
    await running;
  });

  it('blocks hidden actions below minimum terminal size and only allows quit', async () => {
    const directory = await temporaryDirectory();
    const terminal = createTerminal();
    terminal.output.columns = 40;
    terminal.output.rows = 8;
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await terminal.output.waitFor('Terminal too small');
    await terminal.input.waitUntilReady();
    terminal.input.push('j');
    terminal.input.push('\r');
    terminal.input.push('r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal.output.text()).toContain('Terminal too small');
    expect(terminal.output.text()).not.toContain('d status');
    terminal.input.push('q');
    await running;
  });

  it('opens bounded history and run detail through inspection operations', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const historical = createRun('completed');
    const getStepRuns = vi.fn(async (_runId: string, options?: { includeResult?: unknown }) => {
      expect(options?.includeResult === true).toBe(false);
      return [];
    });
    const context: ApplicationService = {
      ...createApplicationService(
        async () => historical,
        () => undefined,
      ),
      listRuns: async () => ({ runs: [historical] }),
      inspectRun: async () => {
        await getStepRuns(historical.id, { includeResult: false });
        return { run: historical, steps: [], artifacts: [], eventCount: 0 };
      },
      explainRunRecovery: async () => ({
        eligible: false,
        reason: 'completed',
        completedStepIds: [],
        retryableStepIds: [],
        workflowVersionCompatible: true,
        actions: [],
      }),
      clarificationQuestions: async () => [],
      loadResearchApprovalPreviews: async () => [],
    };
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await openHistory(terminal);
    await terminal.output.waitFor('Run status');
    expect(getStepRuns).toHaveBeenCalled();
    terminal.input.push('q');
    await terminal.output.waitFor('Press n to start a run.');
    terminal.input.push('q');
    await running;
  });

  it('shows approval message, bounded previews, and workspace warning while waiting', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const waiting = {
      ...createRun('waiting'),
      id: 'run-wait-1',
      workflowId: 'research-plan-build',
      objective: 'Research objective',
    };
    const reportArtifact = {
      id: 'art-1',
      runId: waiting.id,
      stepId: 'research',
      name: 'report',
      kind: 'text' as const,
      path: 'report.txt',
      mediaType: 'text/plain',
      sizeBytes: 12,
    };
    const steps = [
      {
        runId: waiting.id,
        stepId: 'research',
        profile: 'researcher',
        status: 'completed' as const,
        attempt: 1,
      },
      {
        runId: waiting.id,
        stepId: 'research-review',
        profile: 'research-reviewer',
        status: 'completed' as const,
        attempt: 1,
      },
      {
        runId: waiting.id,
        stepId: 'research-approval',
        profile: 'research-reviewer',
        status: 'waiting' as const,
        attempt: 1,
      },
    ];
    const context: ApplicationService = {
      ...createApplicationService(
        async () => waiting,
        () => undefined,
      ),
      listRuns: async () => ({ runs: [waiting] }),
      inspectRun: async () => ({
        run: waiting,
        steps,
        artifacts: [reportArtifact],
        eventCount: 0,
      }),
      explainRunRecovery: async () => ({
        eligible: false,
        reason: 'waiting',
        completedStepIds: ['research', 'research-review'],
        retryableStepIds: [],
        workflowVersionCompatible: true,
        actions: [],
      }),
      clarificationQuestions: async () => [],
      loadResearchApprovalPreviews: async () => [
        {
          artifact: reportArtifact,
          content: 'bounded research preview',
          truncated: false,
          formatted: false,
        },
      ],
    };
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await openHistory(terminal);
    await terminal.output.waitFor('Approval required');
    await terminal.output.waitFor('Approve research and continue');
    expect(stripAnsi(terminal.output.text())).toContain('Review the research');
    expect(stripAnsi(terminal.output.text())).toContain('artifact');
    expect(terminal.output.text()).toContain('bounded research preview');
    expect(stripAnsi(terminal.output.text())).toContain('can modify the');
    expect(stripAnsi(terminal.output.text())).toContain('workspace');
    terminal.input.push('q');
    terminal.input.push('q');
    await terminal.output.waitFor('Press n to start a run.');
    terminal.input.push('q');
    await running;
  }, 15_000);

  it('cancels rejection feedback without changing waiting state', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const waiting = {
      ...createRun('waiting'),
      id: 'run-waiting',
      workflowId: 'research-plan-build',
      objective: 'Needs approval',
    };
    const reportArtifact = {
      id: 'art-report',
      runId: waiting.id,
      stepId: 'research',
      name: 'report',
      kind: 'json' as const,
      path: 'report.json',
      mediaType: 'application/json',
      sizeBytes: 20,
    };
    const context: ApplicationService = {
      ...createApplicationService(
        async () => waiting,
        () => undefined,
      ),
      listRuns: async () => ({ runs: [waiting] }),
      inspectRun: async () => ({
        run: waiting,
        steps: [
          {
            runId: waiting.id,
            stepId: 'research-approval',
            profile: 'human',
            status: 'waiting' as const,
            attempt: 1,
          },
        ],
        artifacts: [reportArtifact],
        eventCount: 2,
      }),
      explainRunRecovery: async () => ({
        eligible: false,
        reason: 'waiting',
        completedStepIds: [],
        retryableStepIds: [],
        workflowVersionCompatible: true,
        actions: [],
      }),
      loadResearchApprovalPreviews: async () => [
        {
          artifact: reportArtifact,
          content: '{"summary":"bounded"}',
          truncated: false,
          formatted: true,
        },
      ],
    };
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });
    await openHistory(terminal);
    await terminal.output.waitFor('Approve research and continue');
    terminal.input.push('j');
    await terminal.output.waitFor('Reject research with feedback');
    terminal.input.push('\r');
    await terminal.output.waitFor('Reject research');
    terminal.input.push('q');
    await terminal.output.waitFor('Approve research and continue');
    expect(terminal.output.text()).toContain('Waiting');
    await new Promise((resolve) => setTimeout(resolve, 100));
    terminal.input.push('q');
    await terminal.output.waitFor('Run detail');
    terminal.input.push('q');
    await terminal.output.waitFor('Press n to start a run.');
    terminal.input.push('q');
    await running;
  }, 15_000);

  it('resumes historical recovery attached and forwards q cancellation', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const failed = { ...createRun('failed'), id: 'run-failed', objective: 'Retry me' };
    const liveRun = { ...createRun('running'), id: 'run-live', objective: 'Retry me' };
    let aborted = false;
    let currentStatus: WorkflowRun['status'] = 'failed';
    let resolveResume: ((run: WorkflowRun) => void) | undefined;
    const resumeExecution = new Promise<WorkflowRun>((resolve) => {
      resolveResume = resolve;
    });
    const context: ApplicationService = {
      ...createApplicationService(
        async () => failed,
        () => undefined,
      ),
      listRuns: async () => ({ runs: [failed] }),
      inspectRun: async (runId) => {
        if (runId === liveRun.id || currentStatus === 'cancelled') {
          return {
            run: { ...liveRun, status: currentStatus === 'cancelled' ? 'cancelled' : 'running' },
            steps: [
              {
                runId: liveRun.id,
                stepId: 'plan',
                profile: 'planner',
                status: 'completed' as const,
                attempt: 1,
              },
              {
                runId: liveRun.id,
                stepId: 'build',
                profile: 'builder',
                status:
                  currentStatus === 'cancelled' ? ('cancelled' as const) : ('running' as const),
                attempt: 1,
              },
            ],
            artifacts: [],
            eventCount: 1,
          };
        }
        return {
          run: failed,
          steps: [
            {
              runId: failed.id,
              stepId: 'plan',
              profile: 'planner',
              status: 'completed' as const,
              attempt: 1,
            },
            {
              runId: failed.id,
              stepId: 'build',
              profile: 'builder',
              status: 'failed' as const,
              attempt: 1,
              error: { message: 'temporary failure', retryable: true },
            },
          ],
          artifacts: [],
          eventCount: 1,
        };
      },
      explainRunRecovery: async () => ({
        eligible: true,
        reason: 'retryable',
        completedStepIds: ['plan'],
        retryableStepIds: ['build'],
        workflowVersionCompatible: true,
        actions: [{ kind: 'resume', label: 'Resume retryable work', requiresConfirmation: false }],
      }),
      resumeWorkflow: async (request) => {
        request.onRunStarted?.(liveRun);
        request.signal?.addEventListener('abort', () => {
          aborted = true;
          currentStatus = 'cancelled';
          setTimeout(() => resolveResume?.({ ...liveRun, status: 'cancelled' }), 100);
        });
        return { run: await resumeExecution, alreadyCompleted: false };
      },
    };
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });
    await openHistory(terminal);
    await terminal.output.waitFor('Resume retryable work');
    terminal.input.push('\r');
    await terminal.output.waitFor('Workflow running');
    terminal.input.push('q');
    await terminal.output.waitFor('Cancellation requested');
    expect(aborted).toBe(true);
    await terminal.output.waitFor('Run status');
    expect(terminal.output.text()).toMatch(/Cancelled|cancelled/i);
    terminal.input.push('q');
    await terminal.output.waitFor('Press n to start a run.');
    terminal.input.push('q');
    await running;
  }, 15_000);

  it('requires typing YES before marking a persisted running run interrupted', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    let currentRunning = {
      ...createRun('running'),
      id: 'run-stale',
      objective: 'Stale owner',
    };
    let interruptions = 0;
    const context: ApplicationService = {
      ...createApplicationService(
        async () => currentRunning,
        () => undefined,
      ),
      listRuns: async () => ({ runs: [currentRunning] }),
      inspectRun: async () => ({ run: currentRunning, steps: [], artifacts: [], eventCount: 0 }),
      explainRunRecovery: async () => ({
        eligible: currentRunning.status === 'interrupted',
        reason: 'recovery',
        completedStepIds: [],
        retryableStepIds: currentRunning.status === 'interrupted' ? ['build'] : [],
        workflowVersionCompatible: true,
        actions:
          currentRunning.status === 'running'
            ? [
                {
                  kind: 'mark-interrupted',
                  label: 'Mark interrupted and review recovery',
                  requiresConfirmation: true,
                },
              ]
            : [{ kind: 'resume', label: 'Resume retryable work', requiresConfirmation: false }],
      }),
      markRunInterrupted: async (runId) => {
        expect(runId).toBe(currentRunning.id);
        interruptions += 1;
        currentRunning = { ...currentRunning, status: 'interrupted' };
        return currentRunning;
      },
    };
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });
    await openHistory(terminal);
    await terminal.output.waitFor('Mark interrupted and review');
    expect(stripAnsi(terminal.output.text())).toContain('Mark interrupted and review');
    expect(stripAnsi(terminal.output.text())).toContain('recovery');
    terminal.input.push('\r');
    await terminal.output.waitFor('Type YES to confirm');
    terminal.input.push('no');
    terminal.input.push('\r');
    await terminal.output.waitFor('Type YES to confirm recovery.');
    expect(interruptions).toBe(0);
    terminal.input.push('\x7f'.repeat(100));
    terminal.input.push('YES');
    await terminal.output.waitFor('YES');
    terminal.input.push('\r');
    await terminal.output.waitFor('Resume retryable work');
    expect(interruptions).toBe(1);
    expect(currentRunning.status).toBe('interrupted');
    terminal.input.push('q');
    await terminal.output.waitFor('Press n to start a run.');
    terminal.input.push('q');
    await running;
  }, 15_000);

  it('shows completion usage, cost, and artifacts after an attached run finishes', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const terminal = createTerminal();
    const context = createApplicationService(
      async (_workflow, request) => {
        const run = createRun('running');
        request.onRunStarted?.(run);
        return {
          ...run,
          status: 'completed',
          updatedAt: new Date().toISOString(),
        };
      },
      () => undefined,
    );
    context.inspectRun = async () => ({
      run: createRun('completed'),
      steps: [
        {
          runId: 'run-1',
          stepId: 'plan',
          profile: 'planner',
          status: 'completed' as const,
          attempt: 1,
          result: { text: '{}', usage: { totalTokens: 12 }, costUsd: 0.004 },
        },
      ],
      artifacts: [
        {
          id: 'artifact-1',
          runId: 'run-1',
          stepId: 'plan',
          name: 'plan',
          kind: 'json' as const,
          path: 'plan.json',
          mediaType: 'application/json',
          sizeBytes: 2,
        },
      ],
      eventCount: 1,
    });
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });
    await launchWorkflow(terminal, false);
    await terminal.output.waitFor('Run status');
    expect(terminal.output.text()).toContain('12 tokens');
    expect(terminal.output.text()).toContain('$0.0040');
    expect(terminal.output.text()).toContain('plan.plan');
    expect(terminal.output.text()).not.toContain('Return home');
    terminal.input.push('q');
    await terminal.output.waitFor('Press n to start a run.');
    terminal.input.push('q');
    await running;
  }, 15_000);
});

class FakeInput extends EventEmitter {
  isTTY = true;
  rawMode: boolean[] = [];
  private readonly chunks: string[] = [];

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }

  setRawMode(enabled: boolean): this {
    this.rawMode.push(enabled);
    return this;
  }

  setEncoding(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.emit('readable');
  }

  read(): string | null {
    return this.chunks.shift() ?? null;
  }

  async waitUntilReady(): Promise<void> {
    for (
      let attempt = 0;
      attempt < 1000 && (!this.rawMode.includes(true) || this.listenerCount('readable') === 0);
      attempt += 1
    ) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(this.rawMode).toContain(true);
    expect(this.listenerCount('readable')).toBeGreaterThan(0);
  }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  private readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  text(): string {
    return this.chunks.join('');
  }

  async waitFor(value: string, attempts = 200): Promise<void> {
    for (
      let attempt = 0;
      attempt < attempts && !stripAnsi(this.text()).includes(value);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(stripAnsi(this.text())).toContain(value);
  }
}

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  return value.replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
}

function createTerminal(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

async function waitForHomeReady(terminal: ReturnType<typeof createTerminal>): Promise<void> {
  await terminal.output.waitFor('BINAFLOW');
  await terminal.input.waitUntilReady();
  terminal.input.push('\r');
  await terminal.output.waitFor('Configuration readiness');
  await terminal.input.waitUntilReady();
}

async function openHistory(terminal: ReturnType<typeof createTerminal>): Promise<void> {
  await waitForHomeReady(terminal);
  terminal.input.push('\t');
  await terminal.output.waitFor('run-');
  terminal.input.push('\r');
}

async function launchWorkflow(
  terminal: ReturnType<typeof createTerminal>,
  waitForLive = true,
): Promise<void> {
  await waitForHomeReady(terminal);
  terminal.input.push('n');
  await terminal.output.waitFor('plan-build');
  terminal.input.push('\r');
  await terminal.output.waitFor('plan-build input');
  terminal.input.push('Run the workflow');
  await terminal.output.waitFor('Run the workflow');
  terminal.input.push('\r');
  await terminal.output.waitFor('Confirm workflow');
  terminal.input.push('\r');
  if (waitForLive) await terminal.output.waitFor('Workflow running');
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'binaflow-ink-shell-'));
  return directory;
}

async function writeConfig(directory: string): Promise<void> {
  await mkdir(join(directory, '.binaflow'), { recursive: true });
  await writeFile(
    join(directory, '.binaflow/config.json'),
    JSON.stringify({
      piCommand: process.execPath,
      profiles: { planner: profile('planner'), builder: profile('builder') },
    }),
  );
}

function profile(model: string): AgentProfile {
  return {
    driver: 'pi',
    provider: 'provider',
    model,
    tools: ['ls', 'find', 'read'],
    workspaceMode: 'read-only',
    projectTrust: 'never',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function createApplicationService(
  execute: WorkflowEngine['execute'],
  subscribe: (listener: (event: NormalizedEvent) => void) => void,
): ApplicationService {
  const profiles = { planner: profile('planner'), builder: profile('builder') };
  return {
    profiles,
    close: () => undefined,
    subscribeEvents: (listener: (event: NormalizedEvent) => void) => {
      subscribe(listener);
      return () => undefined;
    },
    runWorkflow: async (request: {
      workflowId: string;
      objective: string;
      input: Record<string, unknown>;
      runId?: string;
      signal?: AbortSignal;
      onRunStarted?: (run: WorkflowRun) => void;
    }) =>
      execute(
        { version: 1, id: request.workflowId, input: { required: [], properties: {} }, steps: [] },
        {
          objective: request.objective,
          input: request.input,
          profiles,
          ...(request.runId ? { runId: request.runId } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
        },
      ),
    resumeWorkflow: async () => ({ run: createRun('completed'), alreadyCompleted: false }),
    decideApproval: async () => createRun('completed'),
    inspectRun: async () => ({
      run: createRun('completed'),
      steps: [],
      artifacts: [],
      eventCount: 0,
    }),
    listRuns: async () => ({ runs: [] }),
    readArtifact: async () => {
      throw new Error('not implemented');
    },
    explainRunRecovery: async () => ({
      eligible: false,
      reason: 'not implemented',
      completedStepIds: [],
      retryableStepIds: [],
      workflowVersionCompatible: true,
      actions: [],
    }),
    markRunInterrupted: async () => createRun('interrupted'),
    clarificationQuestions: async () => [],
    loadResearchApprovalPreviews: async () => [],
    discoverWorkflows: () => [],
    discoverModels: async () => [],
    diagnoseConfiguration: () => ({ configuredProfiles: [], workflows: [] }),
  };
}

function createRun(status: WorkflowRun['status']): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Run the workflow',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function createDiagnosis(workspacePath: string): ConfigurationDiagnosis {
  return {
    workspacePath,
    configPath: join(workspacePath, '.binaflow/config.json'),
    configExists: false,
    configValid: false,
    errors: [],
    profiles: [],
    workflows: [],
    ready: false,
  };
}
