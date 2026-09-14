import { describe, expect, it } from 'vitest';
import {
  assertGuidedTaskTransition,
  canonicalizeJson,
  canTransitionGuidedTask,
  createGuidedExecutionDigest,
  guidedStepId,
  parseGuidedTaskAgentResult,
  type GuidedExecutionAuthorization,
} from '../src/application/guided-execution.js';

function authorization(): GuidedExecutionAuthorization {
  return {
    contractId: 'contract-1',
    contractRevision: 2,
    todoVersion: 1,
    coordinatorVersion: 1,
    workflowVersion: 1,
    workspace: '/tmp/workspace',
    documents: {
      briefId: 'brief-1',
      briefVersion: 1,
      planId: 'plan-1',
      planVersion: 1,
      todoId: 'todo-1',
      todoVersion: 1,
      approvalId: 'approval-1',
    },
    profile: {
      name: 'builder',
      driver: 'pi',
      model: 'builder-model',
      tools: ['read', 'edit'],
      workspaceMode: 'read-write',
      timeoutMs: 10_000,
      retryLimit: 0,
    },
    commands: [{ command: 'pnpm', args: ['test'], shell: true }],
    files: ['src/example.ts'],
    branch: 'main',
    head: 'abc123',
  };
}

describe('guided execution contracts', () => {
  it('requires a block reason for blocked agent results', () => {
    expect(() =>
      parseGuidedTaskAgentResult({
        decision: 'blocked',
        summary: 'Could not continue',
        files: [],
        evidence: [],
      }),
    ).toThrow('blockReason');
  });

  it('canonicalizes object keys without changing array order', () => {
    expect(canonicalizeJson({ b: 2, a: [3, { d: 4, c: 5 }] })).toBe(
      '{"a":[3,{"c":5,"d":4}],"b":2}',
    );
  });

  it('creates a stable digest that changes when authorization changes', () => {
    const first = authorization();
    expect(createGuidedExecutionDigest(first)).toBe(createGuidedExecutionDigest({ ...first }));
    expect(createGuidedExecutionDigest({ ...first, head: 'def456' })).not.toBe(
      createGuidedExecutionDigest(first),
    );
    expect(
      createGuidedExecutionDigest({
        ...first,
        commands: [{ command: 'pnpm', args: ['lint'], shell: true }],
      }),
    ).not.toBe(createGuidedExecutionDigest(first));
  });

  it('generates deterministic ordinal step IDs and validates transitions', () => {
    expect(guidedStepId(1, 2, 3)).toBe('p001-t002-a003');
    expect(canTransitionGuidedTask('pending', 'running')).toBe(true);
    expect(canTransitionGuidedTask('completed', 'running')).toBe(false);
    expect(() => assertGuidedTaskTransition('completed', 'running')).toThrow(
      'completed -> running',
    );
  });
});
