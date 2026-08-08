import { describe, expect, it, vi } from 'vitest';
import type { ArtifactStore } from '../src/artifacts/artifact-store.js';
import type { AgentProfile } from '../src/config.js';
import type { WorkflowEngine } from '../src/core/engine.js';
import type { NormalizedEvent } from '../src/core/events.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../src/core/run.js';
import {
  decideApproval,
  diagnoseConfiguration,
  inspectRun,
  markRunInterrupted,
  resumeWorkflow,
  runWorkflow,
  type ApplicationContext,
} from '../src/application/operations.js';
import type { RunStore } from '../src/storage/run-store.js';
import { researchPlanBuildWorkflow } from '../src/workflows/research-plan-build.js';

describe('application operations', () => {
  it('diagnoses workflow profile availability without starting a run', () => {
    const diagnosis = diagnoseConfiguration({ profiles: { planner: profile('planner') } });

    expect(diagnosis.configuredProfiles).toEqual(['planner']);
    expect(diagnosis.workflows.find((workflow) => workflow.id === 'plan-build')).toMatchObject({
      missingProfiles: ['builder'],
    });
    expect(
      diagnosis.workflows.find((workflow) => workflow.id === 'research-plan-build'),
    ).toMatchObject({
      experimental: true,
      missingProfiles: ['researcher', 'research-reviewer', 'builder'],
    });
  });

  it('inspects persisted metadata without loading events by default', async () => {
    const run = persistedRun();
    const getEvents = vi.fn(async (): Promise<NormalizedEvent[]> => []);
    const getStepRuns = vi.fn(async (): Promise<StepRun[]> => []);
    const store = {
      getRun: vi.fn(async () => run),
      getStepRuns,
      getArtifacts: vi.fn(async (): Promise<ArtifactReference[]> => []),
      countEvents: vi.fn(async () => 3),
      getEvents,
    } as unknown as RunStore;

    const inspection = await inspectRun({ store }, run.id);

    expect(inspection).toEqual({ run, steps: [], artifacts: [], eventCount: 3 });
    expect(getStepRuns).toHaveBeenCalledWith(run.id, { includeResult: false });
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('loads event and step bodies only when explicitly requested', async () => {
    const run = persistedRun();
    const event: NormalizedEvent = {
      runId: run.id,
      stepId: 'plan',
      type: 'text',
      message: 'full event',
      occurredAt: '2026-01-01T00:00:00.000Z',
    };
    const getEvents = vi.fn(async () => [event]);
    const getStepRuns = vi.fn(async (): Promise<StepRun[]> => []);
    const store = {
      getRun: vi.fn(async () => run),
      getStepRuns,
      getArtifacts: vi.fn(async (): Promise<ArtifactReference[]> => []),
      countEvents: vi.fn(async () => 1),
      getEvents,
    } as unknown as RunStore;

    const inspection = await inspectRun({ store }, run.id, {
      includeEvents: true,
      includeStepResults: true,
    });

    expect(inspection.events).toEqual([event]);
    expect(getStepRuns).toHaveBeenCalledWith(run.id, { includeResult: true });
  });

  it('resolves the workflow and passes application inputs to the engine', async () => {
    const execute = vi.fn(async () => persistedRun());
    const context = {
      config: { profiles: { planner: profile('planner'), builder: profile('builder') } },
      store: {} as RunStore,
      artifacts: {} as ArtifactStore,
      engine: { execute } as unknown as WorkflowEngine,
    } satisfies ApplicationContext;

    await runWorkflow(context, {
      workflowId: 'plan-build',
      objective: 'Improve the workflow',
      input: { objective: 'Improve the workflow', extra: 'keep me' },
      runId: 'run-1',
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plan-build' }),
      expect.objectContaining({
        objective: 'Improve the workflow',
        input: { objective: 'Improve the workflow', extra: 'keep me' },
        profiles: context.config.profiles,
        runId: 'run-1',
      }),
    );
  });

  it('normalizes the objective before passing inputs to the engine', async () => {
    const execute = vi.fn(async () => persistedRun());
    const context = applicationContext(
      { planner: profile('planner'), builder: profile('builder') },
      execute,
    );

    await runWorkflow(context, {
      workflowId: 'plan-build',
      objective: 'Canonical objective',
      input: { objective: 'stale objective', extra: 'keep me' },
    });

    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: { objective: 'Canonical objective', extra: 'keep me' },
      }),
    );
  });

  it('returns completed runs without invoking the engine during resume', async () => {
    const execute = vi.fn(async () => persistedRun());
    const context = applicationContext({}, execute, {
      getRun: async () => persistedRun(),
    });

    const result = await resumeWorkflow(context, { runId: 'run-1' });

    expect(result).toEqual({ run: persistedRun(), alreadyCompleted: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards resume execution dependencies and callbacks', async () => {
    const previous = { ...persistedRun(), status: 'failed' as const };
    const execute = vi.fn(async () => previous);
    const signal = new AbortController().signal;
    const onRunStarted = vi.fn();
    const profiles = { planner: profile('planner'), builder: profile('builder') };
    const context = applicationContext(profiles, execute, {
      getRun: async () => previous,
    });

    await resumeWorkflow(context, { runId: previous.id, signal, onRunStarted });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plan-build' }),
      expect.objectContaining({
        runId: previous.id,
        profiles,
        resume: true,
        signal,
        onRunStarted,
      }),
    );
  });

  it('allows only one concurrent resume to claim a failed run', async () => {
    const previous = { ...persistedRun(), status: 'failed' as const };
    let status: WorkflowRun['status'] = previous.status;
    let executions = 0;
    const execute = vi.fn(async () => {
      executions += 1;
      return { ...previous, status: 'completed' as const };
    });
    const store = {
      getRun: async () => ({ ...previous, status }),
      getArtifacts: async () => [],
      getStepRuns: async () => [
        { runId: previous.id, stepId: 'plan', profile: 'planner', status: 'pending', attempt: 1 },
      ],
      claimRun: async () => {
        if (status !== 'failed') return undefined;
        status = 'running';
        return { ...previous, status: 'running' as const };
      },
      releaseExecution: async () => undefined,
    } as unknown as RunStore;
    const context = {
      config: { profiles: { planner: profile('planner'), builder: profile('builder') } },
      store,
      artifacts: {} as ArtifactStore,
      engine: { execute } as unknown as WorkflowEngine,
    } satisfies ApplicationContext;

    const results = await Promise.allSettled([
      resumeWorkflow(context, { runId: previous.id }),
      resumeWorkflow(context, { runId: previous.id }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: new Error('Run run-1 is already running'),
    });
    expect(executions).toBe(1);
  });

  it('preflights persisted resume input before claiming the run', async () => {
    const previous = { ...persistedRun(), status: 'failed' as const };
    const claimRun = vi.fn(async () => ({ ...previous, status: 'running' as const }));
    const context = applicationContext(
      { planner: profile('planner'), builder: profile('builder') },
      vi.fn(async () => previous),
      {
        getRun: async () => previous,
        getArtifacts: async () => [
          {
            id: 'input',
            runId: previous.id,
            stepId: 'run',
            name: 'input',
            kind: 'json',
            path: '/tmp/input.json',
            mediaType: 'application/json',
            sizeBytes: 2,
          },
        ],
        claimRun,
      },
    );
    context.artifacts = { read: vi.fn(async () => '{}') } as unknown as ArtifactStore;

    await expect(resumeWorkflow(context, { runId: previous.id })).rejects.toThrow(
      'Missing workflow input: objective',
    );
    expect(claimRun).not.toHaveBeenCalled();
  });

  it('rejects an incompatible resume without mutating persisted state', async () => {
    const previous = {
      ...persistedRun(),
      status: 'failed' as const,
      workflowVersion: 2,
      updatedAt: '2026-01-01T00:00:05.000Z',
    };
    const steps: StepRun[] = [
      {
        runId: previous.id,
        stepId: 'plan',
        profile: 'planner',
        status: 'failed',
        attempt: 1,
        error: { message: 'retry me', retryable: true },
      },
      approvalStep(previous.id),
    ];
    const artifacts: ArtifactReference[] = [
      {
        id: 'input',
        runId: previous.id,
        stepId: 'run',
        name: 'input',
        kind: 'json',
        path: '/tmp/input.json',
        mediaType: 'application/json',
        sizeBytes: 32,
      },
    ];
    const claimRun = vi.fn(async () => ({ ...previous, status: 'running' as const }));
    const context = applicationContext(
      { planner: profile('planner'), builder: profile('builder') },
      vi.fn(async () => previous),
      {
        getRun: async () => previous,
        getStepRuns: async () => steps,
        getArtifacts: async () => artifacts,
        claimRun,
      },
    );
    context.artifacts = {
      read: vi.fn(async () => JSON.stringify({ objective: previous.objective })),
    } as unknown as ArtifactStore;
    const before = JSON.stringify({ previous, steps, artifacts });

    await expect(resumeWorkflow(context, { runId: previous.id })).rejects.toThrow(
      'workflow version 2; installed version is 1',
    );
    expect(claimRun).not.toHaveBeenCalled();
    expect(JSON.stringify({ previous, steps, artifacts })).toBe(before);
  });

  it('rejects a non-retryable failed run before claiming it', async () => {
    const previous = { ...persistedRun(), status: 'failed' as const };
    const claimRun = vi.fn(async () => ({ ...previous, status: 'running' as const }));
    const context = applicationContext(
      { planner: profile('planner'), builder: profile('builder') },
      vi.fn(async () => previous),
      {
        getRun: async () => previous,
        getStepRuns: async () => [
          {
            runId: previous.id,
            stepId: 'plan',
            profile: 'planner',
            status: 'failed',
            attempt: 1,
            error: { message: 'permanent', retryable: false },
          },
        ],
        claimRun,
      },
    );

    await expect(resumeWorkflow(context, { runId: previous.id })).rejects.toThrow(
      'has no retryable failed',
    );
    expect(claimRun).not.toHaveBeenCalled();
  });

  it('rejects an invalid execution profile before claiming a retry', async () => {
    const previous = { ...persistedRun(), status: 'failed' as const };
    const claimRun = vi.fn(async () => ({ ...previous, status: 'running' as const }));
    const context = applicationContext(
      { planner: profile('planner'), builder: { ...profile('builder'), timeoutMs: 0 } },
      vi.fn(async () => previous),
      {
        getRun: async () => previous,
        getStepRuns: async () => [
          {
            runId: previous.id,
            stepId: 'build',
            profile: 'builder',
            status: 'failed',
            attempt: 1,
            error: { message: 'retry me', retryable: true },
          },
        ],
        claimRun,
      },
    );

    await expect(resumeWorkflow(context, { runId: previous.id })).rejects.toThrow(
      'Profile builder has invalid configuration',
    );
    expect(claimRun).not.toHaveBeenCalled();
  });

  it('marks a claimed run interrupted when execution fails before starting', async () => {
    const previous = { ...persistedRun(), status: 'failed' as const };
    const markRunInterruptedSpy = vi.fn(async () => ({
      ...previous,
      status: 'interrupted' as const,
    }));
    const context = applicationContext(
      { planner: profile('planner'), builder: profile('builder') },
      vi.fn(async () => {
        throw new Error('pre-execution failure');
      }),
      {
        getRun: async () => ({ ...previous, status: 'running' as const }),
        claimRun: async () => ({ ...previous, status: 'running' as const }),
        markRunInterrupted: markRunInterruptedSpy,
        releaseExecution: async () => undefined,
      },
    );

    await expect(resumeWorkflow(context, { runId: previous.id })).rejects.toThrow(
      'pre-execution failure',
    );
    expect(markRunInterruptedSpy).toHaveBeenCalledWith(previous.id);
  });

  it('marks a persisted running run interrupted through the application operation', async () => {
    const running = { ...persistedRun(), status: 'running' as const };
    const markRunInterruptedSpy = vi.fn(async () => ({
      ...running,
      status: 'interrupted' as const,
    }));
    const context = applicationContext(
      {},
      vi.fn(async () => running),
      {
        getRun: async () => running,
        markRunInterrupted: markRunInterruptedSpy,
      },
    );

    await expect(markRunInterrupted(context, running.id)).resolves.toMatchObject({
      status: 'interrupted',
    });
    expect(markRunInterruptedSpy).toHaveBeenCalledWith(running.id);
  });

  it('persists a normalized approval decision and resumes the workflow', async () => {
    const previous = {
      ...persistedRun(),
      workflowId: researchPlanBuildWorkflow.id,
      status: 'waiting' as const,
    };
    const approval = approvalStep(previous.id);
    const saveStepRun = vi.fn(async () => undefined);
    const execute = vi.fn(async () => previous);
    const profiles = {
      researcher: profile('researcher'),
      'research-reviewer': profile('reviewer'),
      planner: profile('planner'),
      builder: profile('builder'),
    };
    const context = applicationContext(profiles, execute, {
      getRun: async () => previous,
      getStepRuns: async () => [approval],
      saveStepRun,
    });

    await decideApproval(context, {
      runId: previous.id,
      decision: 'rejected',
      feedback: '  Check the migration.  ',
    });

    expect(saveStepRun).toHaveBeenCalledWith({
      ...approval,
      status: 'pending',
      approval: {
        decision: 'rejected',
        feedback: 'Check the migration.',
        decidedAt: expect.any(String),
      },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: researchPlanBuildWorkflow.id }),
      expect.objectContaining({ runId: previous.id, resume: true, profiles }),
    );
  });

  it('marks an approved run interrupted when claimed execution fails before a step starts', async () => {
    const previous = {
      ...persistedRun(),
      workflowId: researchPlanBuildWorkflow.id,
      status: 'waiting' as const,
    };
    const markRunInterrupted = vi.fn(async () => ({
      ...previous,
      status: 'interrupted' as const,
    }));
    const approval = approvalStep(previous.id);
    const context = applicationContext(
      {
        researcher: profile('researcher'),
        'research-reviewer': profile('reviewer'),
        planner: profile('planner'),
        builder: profile('builder'),
      },
      vi.fn(async () => {
        throw new Error('approval continuation failed before execution');
      }),
      {
        getRun: async () => previous,
        getStepRuns: async () => [approval],
        claimApproval: async () => ({ ...previous, status: 'running' as const }),
        markRunInterrupted,
      },
    );

    await expect(
      decideApproval(context, { runId: previous.id, decision: 'approved' }),
    ).rejects.toThrow('approval continuation failed before execution');
    expect(markRunInterrupted).toHaveBeenCalledWith(previous.id);
  });

  it('allows only one concurrent approval decision to claim a waiting run', async () => {
    const previous = {
      ...persistedRun(),
      workflowId: researchPlanBuildWorkflow.id,
      status: 'waiting' as const,
    };
    const approval = approvalStep(previous.id);
    let status: WorkflowRun['status'] = previous.status;
    let executions = 0;
    const execute = vi.fn(async () => {
      executions += 1;
      return { ...previous, status: 'completed' as const };
    });
    const store = {
      getRun: async () => ({ ...previous, status }),
      getArtifacts: async () => [],
      getStepRuns: async () => [approval],
      saveStepRun: async () => undefined,
      claimRun: async () => {
        if (status !== 'waiting') return undefined;
        status = 'running';
        return { ...previous, status: 'running' as const };
      },
      claimApproval: async () => {
        if (status !== 'waiting') return undefined;
        status = 'running';
        return { ...previous, status: 'running' as const };
      },
      releaseExecution: async () => undefined,
    } as unknown as RunStore;
    const context = {
      config: {
        profiles: {
          researcher: profile('researcher'),
          'research-reviewer': profile('reviewer'),
          planner: profile('planner'),
          builder: profile('builder'),
        },
      },
      store,
      artifacts: {} as ArtifactStore,
      engine: { execute } as unknown as WorkflowEngine,
    } satisfies ApplicationContext;

    const results = await Promise.allSettled([
      decideApproval(context, { runId: previous.id, decision: 'approved' }),
      decideApproval(context, { runId: previous.id, decision: 'approved' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: new Error('Run run-1 is already running'),
    });
    expect(executions).toBe(1);
  });

  it('rejects empty feedback before changing the approval step', async () => {
    const previous = {
      ...persistedRun(),
      workflowId: researchPlanBuildWorkflow.id,
      status: 'waiting' as const,
    };
    const saveStepRun = vi.fn(async () => undefined);
    const execute = vi.fn(async () => previous);
    const context = applicationContext(
      {
        researcher: profile('researcher'),
        'research-reviewer': profile('reviewer'),
        planner: profile('planner'),
        builder: profile('builder'),
      },
      execute,
      {
        getRun: async () => previous,
        getStepRuns: async () => [approvalStep(previous.id)],
        saveStepRun,
      },
    );

    await expect(
      decideApproval(context, {
        runId: previous.id,
        decision: 'rejected',
        feedback: '   ',
      }),
    ).rejects.toThrow('Rejection feedback must be non-empty');
    expect(saveStepRun).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects incompatible approval before persisting its decision', async () => {
    const previous = {
      ...persistedRun(),
      workflowId: researchPlanBuildWorkflow.id,
      workflowVersion: 2,
      status: 'waiting' as const,
    };
    const claimApproval = vi.fn(async () => previous);
    const saveStepRun = vi.fn(async () => undefined);
    const context = applicationContext(
      {
        researcher: profile('researcher'),
        'research-reviewer': profile('reviewer'),
        planner: profile('planner'),
        builder: profile('builder'),
      },
      vi.fn(async () => previous),
      {
        getRun: async () => previous,
        getStepRuns: async () => [approvalStep(previous.id)],
        claimApproval,
        saveStepRun,
      },
    );

    await expect(
      decideApproval(context, { runId: previous.id, decision: 'approved' }),
    ).rejects.toThrow('workflow version 2; installed version is 1');
    expect(claimApproval).not.toHaveBeenCalled();
    expect(saveStepRun).not.toHaveBeenCalled();
  });
});

function applicationContext(
  profiles: Record<string, AgentProfile>,
  execute: ReturnType<typeof vi.fn>,
  storeOverrides: Partial<RunStore> = {},
): ApplicationContext {
  const getRun = storeOverrides.getRun ?? (async () => undefined);
  const getStepRuns =
    storeOverrides.getStepRuns ??
    (async (runId: string): Promise<StepRun[]> => [
      {
        runId,
        stepId: 'plan',
        profile: 'planner',
        status: 'pending',
        attempt: 1,
      },
    ]);
  const claimRun =
    storeOverrides.claimRun ??
    (async (runId: string, eligibleStatuses: readonly WorkflowRun['status'][]) => {
      const run = await getRun(runId);
      return run && eligibleStatuses.includes(run.status)
        ? { ...run, status: 'running' as const }
        : undefined;
    });
  const store = {
    getRun,
    getArtifacts: async () => [],
    getStepRuns,
    claimRun,
    claimApproval: async (runId: string, approvalStep: StepRun) => {
      const run = await getRun(runId);
      if (!run || run.status !== 'waiting') return undefined;
      await storeOverrides.saveStepRun?.(approvalStep);
      return { ...run, status: 'running' as const };
    },
    releaseExecution: async () => undefined,
    ...storeOverrides,
  } as unknown as RunStore;
  return {
    config: { profiles },
    store,
    artifacts: {} as ArtifactStore,
    engine: { execute } as unknown as WorkflowEngine,
  } satisfies ApplicationContext;
}

function approvalStep(runId: string): StepRun {
  return {
    runId,
    stepId: 'research-approval',
    profile: 'human',
    status: 'waiting',
    attempt: 1,
  };
}

function profile(model: string): AgentProfile {
  return {
    driver: 'pi',
    model,
    tools: [],
    workspaceMode: 'read-only',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function persistedRun(): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Improve the workflow',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
