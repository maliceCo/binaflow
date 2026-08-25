import { describe, expect, it, vi } from 'vitest';
import type { RunView } from '../src/application/run-view.js';
import type { StepRun } from '../src/core/run.js';
import { CliEventPresenter, printRunSummary } from '../src/cli/commands/common.js';

describe('CLI event presentation', () => {
  it('streams agent messages while keeping status and tool activity readable', () => {
    let output = '';
    const presenter = new CliEventPresenter(false, (text) => {
      output += text;
    });

    presenter.present(event('status', 'Step plan started'));
    presenter.present(event('text', 'hello '));
    presenter.present(event('text', 'world'));
    presenter.present(event('status', 'Pi tool_execution_start tool=read id=call-1'));
    presenter.present(event('error', 'The tool failed'));
    presenter.flush();

    expect(output).toBe(
      '[plan] started\n' +
        '[plan] agent: hello world\n' +
        '[plan] tool started tool=read id=call-1\n' +
        '[plan] error: The tool failed\n',
    );
  });

  it('preserves protocol detail in verbose mode', () => {
    let output = '';
    const presenter = new CliEventPresenter(true, (text) => {
      output += text;
    });

    presenter.present(event('text', 'hello'));
    presenter.present(event('status', 'Step plan completed'));

    expect(output).toBe('hello\n[plan] status: Step plan completed\n');
  });

  it('renders human phases, aggregate metrics, and available actions from RunView', () => {
    const output: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.join(' '));
    });
    const view: RunView = {
      id: 'run-1',
      workflow: { id: 'research-plan-build', version: 1, installedVersion: 1, compatible: true },
      objective: 'Review the repository',
      status: 'waiting',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z',
      phases: [
        {
          id: 'research',
          kind: 'agent',
          profile: 'researcher',
          status: 'completed',
          attempt: 1,
          durationMs: 2_000,
          usage: { totalTokens: 12 },
          costUsd: 0.5,
        },
        {
          id: 'research-approval',
          kind: 'approval',
          profile: 'human',
          status: 'waiting',
          attempt: 1,
        },
      ],
      currentPhaseId: 'research-approval',
      artifacts: [],
      eventCount: 0,
      metrics: { usage: { totalTokens: 12 }, costUsd: 0.5, durationMs: 2_000 },
      availableActions: [
        {
          kind: 'approve-research',
          stepId: 'research-approval',
          label: 'Approve research and continue',
          requiresConfirmation: false,
        },
        {
          kind: 'reject-research',
          stepId: 'research-approval',
          label: 'Reject research and request another iteration',
          requiresConfirmation: false,
          requiresFeedback: true,
        },
      ],
      pendingAction: {
        kind: 'research-approval',
        stepId: 'research-approval',
        message: 'Review the research artifact before planning and execution.',
      },
    };

    try {
      printRunSummary(view);
      const text = output.join('\n');
      expect(text).toContain('research-approval');
      expect(text).toContain('duration=2s');
      expect(text).toContain('cost=$0.5000');
      expect(text).toContain('next=binaflow approve run-1');

      const executionMetadata: StepRun = {
        runId: 'run-1',
        stepId: 'research',
        profile: 'researcher',
        status: 'completed',
        attempt: 1,
        profileSnapshot: {
          driver: 'pi',
          model: 'test-model',
          tools: [],
          workspaceMode: 'read-only',
          timeoutMs: 1_000,
          retryLimit: 0,
        },
      };
      printRunSummary(view, [executionMetadata]);
      expect(output.join('\n')).toContain('driver=pi  model=test-model');

      view.status = 'completed';
      view.phases = [view.phases[0]!];
      delete view.currentPhaseId;
      delete view.pendingAction;
      view.availableActions = [];
      view.followUp = { kind: 'clarification' };
      printRunSummary(view);
      expect(output.join('\n')).toContain(
        'next=run again with an objective that answers the clarification questions',
      );
    } finally {
      log.mockRestore();
    }
  });
});

function event(type: 'status' | 'text' | 'error', message: string) {
  return {
    runId: 'run-1',
    stepId: 'plan',
    type,
    message,
    occurredAt: '2026-01-01T00:00:00.000Z',
  } as const;
}
