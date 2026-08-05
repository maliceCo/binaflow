import { describe, expect, it } from 'vitest';
import { renderCompletion, renderHome } from '../src/tui/render.js';
import type { StepRun, WorkflowRun } from '../src/core/run.js';

describe('Phase 9 presentation safeguards', () => {
  it('keeps home and completion screens within narrow, normal, and wide widths', () => {
    const run: WorkflowRun = {
      id: '12345678-1234-1234-1234-123456789012',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'A long objective that must remain readable without overflowing the terminal',
      status: 'failed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z',
    };
    const steps: StepRun[] = [
      {
        runId: run.id,
        stepId: 'plan',
        profile: 'planner',
        status: 'failed',
        attempt: 1,
        error: { message: 'The planner failed', retryable: true },
      },
    ];

    for (const width of [56, 80, 120]) {
      const home = renderHome({
        workspacePath: 'C:/workspace',
        configPath: 'C:/workspace/.binaflow/config.json',
        configExists: true,
        configValid: true,
        ready: true,
        selectedAction: 0,
        width,
        height: 24,
        colors: false,
      });
      const completion = renderCompletion({
        run,
        steps,
        artifacts: [],
        startedAt: run.createdAt,
        finishedAt: run.updatedAt,
        selected: 0,
        width,
        height: 18,
        colors: false,
      });

      for (const screen of [home, completion]) {
        expect(screen.split('\n').every((line) => line.length <= width)).toBe(true);
        expect(screen).not.toContain('\x1b[');
      }
      expect(completion).toContain('q return home');
    }
  });
});
