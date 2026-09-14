import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink } from '../src/core/events.js';
import type { AgentStepResult, WorkflowRun } from '../src/core/run.js';
import type { GuidedExecutionSnapshot } from '../src/application/guided-execution.js';
import { GuidedExecutionCoordinator } from '../src/application/guided-execution-coordinator.js';
import { createWorkspaceCommandRunner } from '../src/process/workspace-process.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { createWorkflowRuntime } from '../src/core/engine.js';
import { interpretWorkflowDisposition } from '../src/workflows/dispositions.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { LocalGitWorkspace } from '../src/workspace/git-workspace.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

class FixtureDriver implements AgentDriver {
  calls: AgentRequest[] = [];

  async execute(
    request: AgentRequest,
    _emit: EventSink,
    _signal: AbortSignal,
  ): Promise<AgentStepResult> {
    void _emit;
    void _signal;
    this.calls.push(request);
    const path = this.calls.length === 1 ? 'one.ts' : 'two.ts';
    writeFileSync(join(this.workspace, path), `export const ${path[0]} = true;\n`);
    return {
      text: JSON.stringify({
        decision: 'done',
        summary: `updated ${path}`,
        files: [path],
        evidence: [{ criterion: 'done', passed: true, details: 'updated fixture' }],
      }),
    };
  }

  constructor(private readonly workspace: string) {}
}

function snapshot(workspace: string, git: GuidedExecutionSnapshot['git']): GuidedExecutionSnapshot {
  const document = (id: string, kind: 'brief' | 'plan' | 'todo', body: object) => ({
    id,
    contractId: '11111111-1111-4111-8111-111111111111',
    kind,
    version: 1,
    sourceDocumentId: null,
    createdAt: '2026-01-01T00:00:00Z',
    body,
  });
  return {
    contractId: '11111111-1111-4111-8111-111111111111',
    contractRevision: 4,
    coordinatorVersion: 1,
    workflowVersion: 1,
    workspace,
    objective: 'Build two files',
    brief: document('brief', 'brief', {
      objective: 'Build two files',
      conclusions: [],
      constraints: [],
      outOfScope: [],
    }) as GuidedExecutionSnapshot['brief'],
    plan: document('plan', 'plan', {
      briefVersion: 1,
      summary: 'Two changes',
      items: [
        {
          id: 'item-1',
          title: 'One',
          description: 'One',
          files: [{ path: 'one.ts', reason: 'code' }],
          acceptanceCriteria: ['done'],
        },
        {
          id: 'item-2',
          title: 'Two',
          description: 'Two',
          files: [{ path: 'two.ts', reason: 'code' }],
          acceptanceCriteria: ['done'],
        },
      ],
      verification: ['node -e "process.exit(0)"'],
    }) as GuidedExecutionSnapshot['plan'],
    todo: document('todo', 'todo', {
      planVersion: 1,
      phases: ['one.ts', 'two.ts'].map((path, index) => ({
        id: `phase-${index + 1}`,
        title: `Phase ${index + 1}`,
        tasks: [
          {
            id: `task-${index + 1}`,
            planItemId: `item-${index + 1}`,
            instructions: [`update ${path}`],
            files: [path],
            acceptanceCriteria: ['done'],
            verification: ['node -e "process.exit(0)"'],
            stopConditions: ['stop'],
          },
        ],
      })),
      scopeChanges: [],
    }) as GuidedExecutionSnapshot['todo'],
    approval: {
      id: 'approval',
      contractId: '11111111-1111-4111-8111-111111111111',
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
      model: 'fixture',
      tools: ['edit'],
      workspaceMode: 'read-write',
      timeoutMs: 10_000,
      retryLimit: 0,
    },
    git,
    commands: [],
    files: ['one.ts', 'two.ts'],
  };
}

describe('guided execution with real SQLite, artifacts, and Git', () => {
  it('creates one verified commit per phase and preserves the checkpoint history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-guided-integration-'));
    directories.push(directory);
    const workspace = join(directory, 'workspace');
    mkdirSync(workspace);
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
    execFileSync('git', ['config', 'user.name', 'Binaflow Test'], { cwd: workspace });
    writeFileSync(join(workspace, 'one.ts'), 'export const o = false;\n');
    writeFileSync(join(workspace, 'two.ts'), 'export const t = false;\n');
    execFileSync('git', ['add', '--', 'one.ts', 'two.ts'], { cwd: workspace });
    execFileSync('git', ['commit', '-qm', 'initial'], { cwd: workspace });

    const store = new SqliteRunStore(join(directory, 'runs.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const gitWorkspace = new LocalGitWorkspace();
    const initialGit = await gitWorkspace.preflight(workspace);
    const driver = new FixtureDriver(workspace);
    const runtime = createWorkflowRuntime(store, artifacts, driver, undefined, {
      interpretDisposition: interpretWorkflowDisposition,
    });
    const coordinator = new GuidedExecutionCoordinator(
      runtime,
      store,
      store,
      artifacts,
      gitWorkspace,
      createWorkspaceCommandRunner(),
    );
    const contractId = '11111111-1111-4111-8111-111111111111';
    let contract = await store.createTaskContract({
      contractId,
      workspace,
      brief: {
        objective: 'Build two files',
        conclusions: [],
        constraints: [],
        outOfScope: [],
      },
    });
    contract = await store.publishTaskContractPlan({
      contractId,
      workspace,
      expectedRevision: contract.contract.revision,
      plan: {
        briefVersion: 1,
        summary: 'Two changes',
        items: [
          {
            id: 'item-1',
            title: 'One',
            description: 'One',
            files: [{ path: 'one.ts', reason: 'code' }],
            acceptanceCriteria: ['done'],
          },
          {
            id: 'item-2',
            title: 'Two',
            description: 'Two',
            files: [{ path: 'two.ts', reason: 'code' }],
            acceptanceCriteria: ['done'],
          },
        ],
        verification: ['node -e "process.exit(0)"'],
      },
    });
    contract = await store.approveTaskContractPlan({
      contractId,
      workspace,
      expectedRevision: contract.contract.revision,
      planVersion: 1,
    });
    contract = await store.publishTaskContractTodo({
      contractId,
      workspace,
      expectedRevision: contract.contract.revision,
      todo: snapshot(workspace, initialGit).todo.body,
    });
    if (!contract.currentPlan || !contract.currentTodo || !contract.approval)
      throw new Error('fixture contract is incomplete');
    const currentSnapshot = {
      ...snapshot(workspace, initialGit),
      contractId,
      contractRevision: contract.contract.revision,
      brief: contract.currentBrief,
      plan: contract.currentPlan,
      todo: contract.currentTodo,
      approval: contract.approval,
    } satisfies GuidedExecutionSnapshot;
    const runId = 'guided-123e4567-e89b-42d3-a456-426614174000';
    const snapshotArtifact = await artifacts.write(
      runId,
      'execution',
      'execution.SNAPSHOT.json',
      'json',
      JSON.stringify(currentSnapshot),
      'application/json',
    );
    const todoArtifact = await artifacts.write(
      runId,
      'execution',
      'execution.TODO.md',
      'text',
      '# TODO\n',
      'text/markdown',
    );
    const inputArtifact = await artifacts.write(
      runId,
      'run',
      'input',
      'json',
      JSON.stringify({ objective: currentSnapshot.objective }),
      'application/json',
    );
    await store.createGuidedExecution({
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      snapshot: currentSnapshot,
      snapshotArtifact,
      todoArtifact,
      inputArtifact,
    });
    const claim = await store.claimGuidedExecution(runId, ['pending']);
    if (!claim) throw new Error('fixture claim was not created');
    const run = (await store.getRun(runId)) as WorkflowRun;
    expect(run.status).toBe('running');
    await store.assertExecutionClaim(claim);
    const result = await coordinator.execute({
      run,
      snapshot: currentSnapshot,
      claim,
      profiles: { builder: currentSnapshot.profile },
    });
    await store.releaseGuidedExecution(runId, claim);

    expect(result.status).toBe('waiting');
    expect(result.phases.map((phase) => phase.commitSha)).toHaveLength(2);
    expect(result.phases.every((phase) => phase.commitSha)).toBe(true);
    expect(driver.calls).toHaveLength(2);
    expect(readFileSync(join(workspace, 'one.ts'), 'utf8')).toContain('true');
    expect(readFileSync(join(workspace, 'two.ts'), 'utf8')).toContain('true');
    const log = execFileSync('git', ['log', '-3', '--format=%H %s%n%B'], {
      cwd: workspace,
      encoding: 'utf8',
    });
    expect(log).toContain('Binaflow-Checkpoint:');
    const commits = await Promise.all(
      result.phases.map((phase) => gitWorkspace.inspectCommit(workspace, phase.commitSha!)),
    );
    expect(commits[1]?.parent).toBe(commits[0]?.sha);
    expect(commits.every((commit) => commit.trailer?.startsWith(`${runId}/`))).toBe(true);
    expect(
      (await store.getStepRuns(runId)).filter((step) => step.status === 'completed'),
    ).toHaveLength(2);
    store.close();
  });
});
