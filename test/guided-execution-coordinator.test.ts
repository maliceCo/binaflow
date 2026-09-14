import { describe, expect, it } from 'vitest';
import type {
  GuidedExecutionClaim,
  GuidedExecutionProgress,
  GuidedExecutionSnapshot,
  WorkspaceCommandResult,
} from '../src/application/guided-execution.js';
import { GuidedExecutionCoordinator } from '../src/application/guided-execution-coordinator.js';
import type {
  GitWorkspace,
  GuidedExecutionStore,
  WorkspaceCommandRunner,
} from '../src/application/ports.js';
import type { AgentProfile } from '../src/core/agent-profile.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../src/core/run.js';

function progress(): GuidedExecutionProgress {
  return {
    runId: 'guided-run',
    contractId: 'contract',
    revision: 1,
    stage: 'execution',
    status: 'pending',
    phases: [
      {
        id: 'phase-1',
        ordinal: 1,
        title: 'First',
        status: 'pending',
        tasks: [{ id: 'task-1', phaseId: 'phase-1', ordinal: 1, status: 'pending', attempt: 1 }],
      },
      {
        id: 'phase-2',
        ordinal: 2,
        title: 'Second',
        status: 'pending',
        tasks: [{ id: 'task-2', phaseId: 'phase-2', ordinal: 1, status: 'pending', attempt: 1 }],
      },
    ],
    activeBlock: null,
    nextAction: 'execute',
  };
}

function snapshot(): GuidedExecutionSnapshot {
  const document = (id: string, kind: 'brief' | 'plan' | 'todo', body: object) => ({
    id,
    contractId: 'contract',
    kind,
    version: 1,
    sourceDocumentId: null,
    createdAt: '2026-01-01T00:00:00Z',
    body,
  });
  return {
    contractId: 'contract',
    contractRevision: 4,
    coordinatorVersion: 1,
    workflowVersion: 1,
    workspace: '/workspace',
    objective: 'Build it',
    brief: document('brief', 'brief', {
      objective: 'Build it',
      conclusions: [],
      constraints: [],
      outOfScope: [],
    }) as GuidedExecutionSnapshot['brief'],
    plan: document('plan', 'plan', {
      briefVersion: 1,
      summary: 'Plan',
      items: [],
      verification: [],
    }) as GuidedExecutionSnapshot['plan'],
    todo: document('todo', 'todo', {
      planVersion: 1,
      phases: [
        {
          id: 'phase-1',
          title: 'First',
          tasks: [
            {
              id: 'task-1',
              planItemId: 'item-1',
              instructions: ['one'],
              files: ['one.ts'],
              acceptanceCriteria: ['done'],
              verification: ['verify-one'],
              stopConditions: ['stop'],
            },
          ],
        },
        {
          id: 'phase-2',
          title: 'Second',
          tasks: [
            {
              id: 'task-2',
              planItemId: 'item-2',
              instructions: ['two'],
              files: ['two.ts'],
              acceptanceCriteria: ['done'],
              verification: ['verify-two'],
              stopConditions: ['stop'],
            },
          ],
        },
      ],
      scopeChanges: [],
    }) as GuidedExecutionSnapshot['todo'],
    approval: {
      id: 'approval',
      contractId: 'contract',
      sequence: 1,
      kind: 'approve-plan',
      targetDocumentId: 'plan',
      relatedActionId: null,
      details: {},
      createdAt: '2026-01-01T00:00:00Z',
    },
    profile: {
      name: 'builder',
      driver: 'pi',
      model: 'test',
      tools: ['edit'],
      workspaceMode: 'read-write',
      timeoutMs: 1000,
      retryLimit: 0,
    },
    git: { workspace: '/workspace', branch: 'main', head: 'parent', clean: true, changes: [] },
    commands: [],
    files: ['one.ts', 'two.ts'],
  };
}

class FakePersistence implements GuidedExecutionStore {
  current = progress();
  async createGuidedExecution(): Promise<GuidedExecutionProgress> {
    return this.current;
  }
  async getGuidedExecution(): Promise<GuidedExecutionProgress> {
    return this.current;
  }
  async getGuidedExecutionByRequest(): Promise<GuidedExecutionProgress | undefined> {
    return undefined;
  }
  async getGuidedExecutionRequest(): Promise<
    { contractId: string; authorizationDigest: string } | undefined
  > {
    return undefined;
  }
  async listGuidedExecutions(): Promise<{ items: GuidedExecutionProgress[] }> {
    return { items: [this.current] };
  }
  async claimGuidedExecution(): Promise<GuidedExecutionClaim> {
    return { runId: this.current.runId, token: 'claim', revision: this.current.revision };
  }
  async assertGuidedExecutionClaim(): Promise<void> {}
  async saveGuidedCheckpoint(
    checkpoint: { runId: string; phaseId: string },
    _claim: GuidedExecutionClaim,
  ): Promise<GuidedExecutionProgress> {
    void checkpoint;
    void _claim;
    this.current = { ...this.current, revision: this.current.revision + 1 };
    return this.current;
  }
  async saveGuidedDecision(): Promise<GuidedExecutionProgress> {
    return this.current;
  }
  async saveGuidedCommitIntent(): Promise<GuidedExecutionProgress> {
    this.current = { ...this.current, revision: this.current.revision + 1 };
    return this.current;
  }
  async completeGuidedPhase(
    runId: string,
    phaseId: string,
    commitSha: string | null,
  ): Promise<GuidedExecutionProgress> {
    this.current = {
      ...this.current,
      revision: this.current.revision + 1,
      phases: this.current.phases.map((phase) =>
        phase.id === phaseId
          ? { ...phase, status: 'completed', ...(commitSha ? { commitSha } : {}) }
          : phase,
      ),
    };
    return this.current;
  }
  async saveGuidedProgress(progressValue: GuidedExecutionProgress): Promise<void> {
    this.current = progressValue;
  }
  async releaseGuidedExecution(): Promise<void> {}
}

class FakeArtifacts {
  readonly values = new Map<string, string>();
  async read(artifact: ArtifactReference): Promise<string> {
    return this.values.get(artifact.id)!;
  }
  async readBounded(artifact: ArtifactReference): Promise<{ content: string; truncated: boolean }> {
    return { content: await this.read(artifact), truncated: false };
  }
  async write(
    runId: string,
    stepId: string,
    name: string,
    kind: 'json' | 'text',
    content: string,
    mediaType: string,
  ): Promise<ArtifactReference> {
    const artifact = {
      id: `${stepId}-${name}`,
      runId,
      stepId,
      name,
      kind,
      path: `/tmp/${stepId}-${name}`,
      mediaType,
      sizeBytes: content.length,
    };
    this.values.set(artifact.id, content);
    return artifact;
  }
  async remove(): Promise<void> {}
}

function fakeGit(): GitWorkspace {
  let calls = 0;
  const state = (head: string, path?: string) => ({
    workspace: '/workspace',
    branch: 'main',
    head,
    clean: !path,
    changes: path ? [{ path, status: ' M', mode: '100644', contentHash: 'hash' }] : [],
  });
  return {
    inspect: async () => {
      calls += 1;
      if (calls === 2 || calls === 3) return state('parent', 'one.ts');
      if (calls === 5 || calls === 6) return state('parent', 'two.ts');
      return state(calls > 6 ? `commit-${calls}` : 'parent');
    },
    preflight: async () => state('parent'),
    validatePaths: async () => {},
    stagePaths: async () => {},
    inspectStagedTree: async () => ({ tree: 'tree', fingerprint: state('parent', 'one.ts') }),
    commitPhase: async () => 'commit-sha',
    inspectCommit: async (_workspace, sha) => ({
      sha,
      parent: 'parent',
      tree: 'tree',
      branch: 'main',
      trailer: 'guided-run/phase-1-commit-token',
      fingerprint: state(sha),
    }),
    reconcileCommitIntent: async () => ({ commitSha: null, noChanges: true }),
  };
}

const run: WorkflowRun = {
  id: 'guided-run',
  workflowId: 'guided-task-build',
  workflowVersion: 1,
  objective: 'Build it',
  status: 'running',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const profile: AgentProfile = {
  driver: 'pi',
  model: 'test',
  tools: ['edit'],
  workspaceMode: 'read-write',
  timeoutMs: 1000,
  retryLimit: 0,
};

describe('GuidedExecutionCoordinator', () => {
  it('executes tasks in order and ends waiting for changes review', async () => {
    const persistence = new FakePersistence();
    const artifacts = new FakeArtifacts();
    const executed: string[] = [];
    const runtime = {
      executeStep: async (
        _run: WorkflowRun,
        step: { id: string },
      ): Promise<{ stepRun: StepRun; artifacts: ArtifactReference[] }> => {
        executed.push(step.id);
        const artifact = await artifacts.write(
          run.id,
          step.id,
          'result',
          'json',
          JSON.stringify({ decision: 'done', summary: 'done', files: [], evidence: [] }),
          'application/json',
        );
        return {
          stepRun: {
            runId: run.id,
            stepId: step.id,
            profile: 'builder',
            status: 'completed',
            attempt: 1,
          },
          artifacts: [artifact],
        };
      },
    };
    const commands: WorkspaceCommandRunner = {
      run: async (command): Promise<WorkspaceCommandResult> => ({
        command,
        args: [],
        exitCode: 0,
        signal: null,
        stdout: 'ok',
        stderr: '',
        truncated: false,
        timedOut: false,
        aborted: false,
        ok: true,
      }),
    };
    const coordinator = new GuidedExecutionCoordinator(
      runtime,
      { getStepRuns: async () => [], getArtifacts: async () => [] },
      persistence,
      artifacts,
      fakeGit(),
      commands,
    );
    const result = await coordinator.execute({
      run,
      snapshot: snapshot(),
      claim: { runId: run.id, token: 'claim', revision: 1 },
      profiles: { builder: profile },
    });
    expect(executed).toEqual(['p001-t001-a001', 'p002-t001-a001']);
    expect(result).toMatchObject({
      status: 'waiting',
      stage: 'changes-review',
      nextAction: 'review-changes',
    });
    expect(result.phases.every((phase) => phase.status === 'completed')).toBe(true);
  });
});
