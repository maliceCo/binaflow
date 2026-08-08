import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ArtifactStore } from '../src/artifacts/artifact-store.js';
import type { AgentProfile } from '../src/config.js';
import type { ApplicationContext, ArtifactContentView } from '../src/application/operations.js';
import type { WorkflowEngine } from '../src/core/engine.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../src/core/run.js';
import { runTui, type TuiInput, type TuiOutput } from '../src/tui/app.js';
import type { RunListQuery, RunStore } from '../src/storage/run-store.js';
import {
  renderArtifacts,
  renderHistory,
  renderRunDetail,
  type ArtifactViewModel,
  type HistoryViewModel,
  type RunDetailViewModel,
} from '../src/tui/render.js';

describe('Phase 8 attached history and inspection UI', () => {
  it('renders separate attention runs, filters, relative time, and bounded pagination', () => {
    const model: HistoryViewModel = {
      runs: [run('completed', 'plan-build')],
      attentionRuns: [run('failed', 'research-plan-build')],
      selected: 0,
      statusFilter: 'completed',
      workflowFilter: 'plan-build',
      attentionOnly: false,
      hasNextPage: true,
      width: 120,
      height: 40,
      colors: false,
    };
    const screen = renderHistory(model);
    expect(screen).toContain('Attention required');
    expect(screen).toContain('Failed');
    expect(screen).toContain('Completed');
    expect(screen).toContain('status=completed');
    expect(screen).toContain('ago');
    expect(screen).toContain('event and artifact bodies are not loaded');
  });

  it('renders metadata, legacy explanation, recovery safety, clarification, approval, and feedback', () => {
    const inspection: RunDetailViewModel['inspection'] = {
      run: run('waiting', 'research-plan-build'),
      steps: [
        {
          ...step('research', 'completed'),
          profileSnapshot: {
            driver: 'pi',
            provider: 'provider',
            model: 'researcher',
            tools: ['read'],
            workspaceMode: 'read-only' as const,
            timeoutMs: 1_000,
            retryLimit: 0,
          },
          result: { text: 'research result' },
        },
        {
          ...step('research-approval', 'waiting'),
          approval: { decision: 'rejected' as const, feedback: 'Check evidence' },
        },
      ],
      artifacts: [
        artifact('research', 'report', 'json'),
        artifact('research-review', 'review', 'json'),
      ],
      eventCount: 4,
    };
    const model: RunDetailViewModel = {
      inspection,
      recovery: {
        eligible: false,
        reason: 'This run is waiting for its workflow-specific approval action.',
        completedStepIds: ['research'],
        retryableStepIds: [],
        workflowVersionCompatible: true,
      },
      clarificationQuestions: ['Which evidence is required?'],
      approvalMessage: 'Review the research artifact before planning and execution.',
      approvalPreviews: [
        {
          artifact: artifact('research', 'report', 'json'),
          content: '{"summary":"evidence"}',
          truncated: false,
          formatted: true,
        },
        {
          artifact: artifact('research-review', 'review', 'json'),
          truncated: false,
          formatted: false,
          error: 'Artifact cannot be read',
        },
      ],
      actions: [
        'Approve research and continue',
        'Reject research with feedback',
        'Browse artifacts',
        'Back to history',
      ],
      selected: 0,
      width: 140,
      height: 60,
      colors: false,
    };
    const screen = renderRunDetail(model);
    expect(screen).toContain('provider=provider');
    expect(screen).toContain('Events:    4');
    expect(screen).toContain('research.report [intermediate]');
    expect(screen).toContain('Which evidence is required?');
    expect(screen).toContain('Approval may lead to workspace modifications');
    expect(screen).toContain('feedback=Check evidence');
    expect(screen).toContain('Completed steps are never silently rerun');
    expect(screen).toContain('research.report preview:');
    expect(screen).toContain('research-review.review: ERROR Artifact cannot be read');
    const normalHeight = renderRunDetail({ ...model, height: 24 });
    expect(normalHeight).toContain('Approve research and continue');
    expect(normalHeight).toContain('research.report preview:');
  });

  it('renders bounded text and formatted-artifact errors without crashing', () => {
    const content = {
      artifact: artifact('plan', 'plan', 'json'),
      content: '{\n  "ok": true\n}',
      truncated: false,
      formatted: true,
    };
    const model: ArtifactViewModel = {
      artifacts: [artifact('plan', 'plan', 'json'), artifact('build', 'result', 'text')],
      selected: 0,
      content,
      width: 120,
      height: 40,
      colors: false,
    };
    expect(renderArtifacts(model)).toContain('"ok": true');
    expect(
      renderArtifacts({
        ...model,
        content: {
          artifact: content.artifact,
          truncated: false,
          formatted: false,
          error: 'Artifact JSON is corrupt',
        } satisfies ArtifactContentView,
      }),
    ).toContain('ERROR: Artifact JSON is corrupt');
  });

  it('opens history from home, applies a status filter, opens a run, and returns safely', async () => {
    const terminal = createTerminal();
    const runValue = run('completed', 'plan-build');
    const context = applicationContext(runValue);
    const running = runTui({
      input: terminal.input,
      output: terminal.output,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, 'jj\r');
    await waitFor(terminal.output, 'Run history');
    send(terminal.input, 's');
    await waitFor(terminal.output, 'status=failed');
    send(terminal.input, 's');
    await waitFor(terminal.output, 'status=interrupted');
    send(terminal.input, 'ss');
    await waitFor(terminal.output, 'status=completed');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Run detail');
    expect(terminal.output.text()).toContain('Completed steps are never silently rerun');
    send(terminal.input, 'q');
    await waitFor(terminal.output, 'Run history');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('returns from rejection feedback with q or Escape without changing waiting state', async () => {
    const terminal = createTerminal();
    const report = artifact('research', 'report', 'json');
    const review = artifact('research-review', 'review', 'json');
    const context = applicationContext(run('waiting', 'research-plan-build'), true, [
      report,
      review,
    ]);
    const running = runTui({
      input: terminal.input,
      output: terminal.output,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, 'jj\r');
    await waitFor(terminal.output, 'Run history');
    await waitFor(terminal.output, 'Inspect this run');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Approve research and continue');
    expect(terminal.output.text()).toContain('research.report preview:');
    expect(terminal.output.text()).toContain('research-review.review: ERROR');
    send(terminal.input, 'j\r');
    await waitFor(terminal.output, 'Reject research');
    send(terminal.input, 'q');
    await waitFor(terminal.output, 'Run detail');
    expect(terminal.output.text()).toContain('Status:    Waiting for approval');
    send(terminal.input, 'j\r');
    await waitFor(terminal.output, 'Reject research');
    send(terminal.input, '\x1b');
    await waitFor(terminal.output, 'Run detail');
    expect(terminal.output.text()).toContain('Status:    Waiting for approval');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('runs historical recovery attached and forwards q cancellation to the engine', async () => {
    const terminal = createTerminal();
    let aborted = false;
    let resolveExecution: ((run: WorkflowRun) => void) | undefined;
    const execution = new Promise<WorkflowRun>((resolve) => {
      resolveExecution = resolve;
    });
    const failedRun = run('failed', 'plan-build');
    const context: ApplicationContext = {
      config: { profiles: { planner: profile('planner'), builder: profile('builder') } },
      store: {
        listRunsPage: async () => ({ runs: [failedRun] }),
        getRun: async () => failedRun,
        getStepRuns: async () => [
          step('plan', 'completed'),
          {
            ...step('build', 'failed'),
            error: { message: 'temporary failure', retryable: true },
          },
        ],
        getArtifacts: async () => [],
        countEvents: async () => 0,
        claimRun: async () => ({ ...failedRun, status: 'running' as const }),
        claimApproval: async () => undefined,
        markRunInterrupted: async () => undefined,
        releaseExecution: async () => undefined,
      } as unknown as RunStore,
      artifacts: {} as ArtifactStore,
      engine: {
        execute: async (_workflow, request) => {
          await request.onRunStarted?.(run('running', 'plan-build'));
          request.signal?.addEventListener('abort', () => {
            aborted = true;
            resolveExecution?.(run('cancelled', 'plan-build'));
          });
          return execution;
        },
      } as WorkflowEngine,
    };
    const running = runTui({
      input: terminal.input,
      output: terminal.output,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, 'jj\r');
    await waitFor(terminal.output, 'Inspect this run');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Resume retryable work');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Live workflow');
    send(terminal.input, 'q');
    await waitFor(terminal.output, 'Cancellation requested');
    expect(aborted).toBe(true);
    await waitFor(terminal.output, 'Status:    Cancelled');
    send(terminal.input, 'q');
    await waitFor(terminal.output, 'Run detail');
    expect(terminal.output.text()).toContain('Resume retryable work');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('requires explicit confirmation before recovering a persisted running run', async () => {
    const terminal = createTerminal();
    let current = run('running', 'plan-build');
    let interruptions = 0;
    const base = applicationContext(current);
    const context: ApplicationContext = {
      ...base,
      store: {
        ...base.store,
        listRunsPage: async () => ({ runs: [current] }),
        getRun: async () => current,
        markRunInterrupted: async (runId: string) => {
          expect(runId).toBe(current.id);
          interruptions += 1;
          current = { ...current, status: 'interrupted' };
          return current;
        },
      } as unknown as RunStore,
    };
    const running = runTui({
      input: terminal.input,
      output: terminal.output,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, 'jj\r');
    await waitFor(terminal.output, 'Inspect this run');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Mark interrupted and review recovery');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Type YES to confirm');
    send(terminal.input, 'no\r');
    await waitFor(terminal.output, 'Type YES to confirm recovery.');
    expect(interruptions).toBe(0);
    send(terminal.input, '\b\b');
    send(terminal.input, 'YES\r');
    await waitFor(terminal.output, 'Run marked interrupted. Review recovery before resuming.');
    expect(interruptions).toBe(1);
    expect(current.status).toBe('interrupted');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });
});

class FakeInput extends EventEmitter implements TuiInput {
  isTTY = true;
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  setRawMode(): this {
    return this;
  }
}

class FakeOutput extends EventEmitter implements TuiOutput {
  isTTY = true;
  columns = 140;
  rows = 60;
  private chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

function createTerminal(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

function send(input: FakeInput, value: string): void {
  for (const character of value) input.emit('data', Buffer.from(character));
}

async function waitFor(output: FakeOutput, text: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !output.text().includes(text); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(output.text()).toContain(text);
}

function applicationContext(
  runValue: WorkflowRun,
  waitingApproval = false,
  approvalArtifacts: ArtifactReference[] = [],
): ApplicationContext {
  return {
    config: { profiles: { planner: profile('planner'), builder: profile('builder') } },
    store: {
      listRunsPage: async (query: RunListQuery = {}) => ({
        runs: query.status && query.status !== runValue.status ? [] : [runValue],
        ...(query.cursor ? {} : { nextCursor: 'cursor' }),
      }),
      getRun: async () => runValue,
      getStepRuns: async () =>
        waitingApproval
          ? [
              {
                runId: runValue.id,
                stepId: 'research-approval',
                profile: 'human',
                status: 'waiting',
                attempt: 1,
              },
            ]
          : [step('plan', 'completed')],
      getArtifacts: async () => approvalArtifacts,
      countEvents: async () => 2,
      claimRun: async () => ({ ...runValue, status: 'running' as const }),
      claimApproval: async () => undefined,
      markRunInterrupted: async () => undefined,
      releaseExecution: async () => undefined,
    } as unknown as RunStore,
    artifacts: {
      readBounded: async (candidate: ArtifactReference) => {
        if (candidate.name === 'review') throw new Error('review file is corrupt');
        return { content: '{"summary":"bounded evidence"}', truncated: false };
      },
    } as unknown as ArtifactStore,
    engine: {} as WorkflowEngine,
  };
}

function profile(model: string): AgentProfile {
  return {
    driver: 'pi',
    model,
    tools: ['read'],
    workspaceMode: 'read-only',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function run(status: WorkflowRun['status'], workflowId: string): WorkflowRun {
  return {
    id: 'run-1',
    workflowId,
    workflowVersion: 1,
    objective: 'Inspect this run',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  };
}

function step(stepId: string, status: StepRun['status']): StepRun {
  return { runId: 'run-1', stepId, profile: 'planner', status, attempt: 1 };
}

function artifact(
  stepId: string,
  name: string,
  kind: ArtifactReference['kind'],
): ArtifactReference {
  return {
    id: `${stepId}-${name}`,
    runId: 'run-1',
    stepId,
    name,
    kind,
    path: `${stepId}-${name}.${kind === 'json' ? 'json' : 'txt'}`,
    mediaType: kind === 'json' ? 'application/json' : 'text/plain',
    sizeBytes: 20,
  };
}
