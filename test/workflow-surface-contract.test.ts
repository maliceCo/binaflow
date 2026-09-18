import { describe, expect, it } from 'vitest';
import { discoverWorkflows } from '../src/application/operations.js';
import {
  WORKFLOW_SURFACE_CONTRACT_VERSION,
  discoverWorkflowSurfaceContracts,
  supportForWorkflowSurface,
} from '../src/application/workflow-surface.js';

describe('workflow surface contract', () => {
  it('publishes direct workflows as CLI/TUI operations and Web unsupported', () => {
    const directIds = discoverWorkflows().map((workflow) => workflow.id);
    const contracts = discoverWorkflowSurfaceContracts();

    expect(contracts).toHaveLength(directIds.length * 3 + 3);
    for (const workflowId of directIds) {
      expect(supportForWorkflowSurface(workflowId, 'cli')).toMatchObject({
        contractVersion: WORKFLOW_SURFACE_CONTRACT_VERSION,
        mode: 'operate',
      });
      expect(supportForWorkflowSurface(workflowId, 'tui')).toMatchObject({ mode: 'operate' });
      expect(supportForWorkflowSurface(workflowId, 'web')).toMatchObject({
        mode: 'unsupported',
        capabilities: [],
      });
    }
    expect(discoverWorkflows().some((workflow) => workflow.id === 'guided-task-build')).toBe(false);
  });

  it('declares guided task support without claiming future diff or QA capabilities', () => {
    const web = supportForWorkflowSurface('guided-task-build', 'web');
    const cli = supportForWorkflowSurface('guided-task-build', 'cli');
    const tui = supportForWorkflowSurface('guided-task-build', 'tui');

    expect(web).toMatchObject({ mode: 'operate' });
    expect(web?.capabilities).toEqual([
      'create-task',
      'prepare-task',
      'approve-plan',
      'execute-task',
      'observe-execution',
      'resume-execution',
      'cancel-execution',
      'view-change-summary',
    ]);
    expect(cli).toMatchObject({ mode: 'observe' });
    expect(tui).toMatchObject({ mode: 'observe' });
    expect(cli?.capabilities).toEqual(['observe-execution', 'view-change-summary']);
    expect(web?.capabilities).not.toContain('view-structured-diff');
    expect(web?.capabilities).not.toContain('approve-changes');
    expect(supportForWorkflowSurface('unknown', 'web')).toBeUndefined();
  });
});
