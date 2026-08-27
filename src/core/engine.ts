import type { AgentDriver } from './agent.js';
import type { EventSink } from './events.js';
import type { WorkflowArtifactStore, WorkflowExecutionStore } from './ports.js';
import type { WorkflowDefinition } from './workflow.js';
import { WorkflowRuntime, type WorkflowRuntimeOptions } from './workflow-runtime.js';
import type { ExecuteWorkflowRequest } from './execute-request.js';

export type { OutputDispositionInterpreter } from './workflow-runtime.js';

export class WorkflowEngine {
  private readonly runtime: WorkflowRuntime;

  constructor(
    runStore: WorkflowExecutionStore,
    artifactStore: WorkflowArtifactStore,
    driver: AgentDriver,
    eventSink: EventSink = () => undefined,
    options: WorkflowRuntimeOptions = {},
  ) {
    this.runtime = new WorkflowRuntime(runStore, artifactStore, driver, eventSink, options);
  }

  async execute(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
  ): Promise<import('./run.js').WorkflowRun> {
    return this.runtime.executeSequential(workflow, request);
  }
}

export function createWorkflowRuntime(
  runStore: WorkflowExecutionStore,
  artifactStore: WorkflowArtifactStore,
  driver: AgentDriver,
  eventSink: EventSink = () => undefined,
  options: WorkflowRuntimeOptions = {},
): WorkflowRuntime {
  return new WorkflowRuntime(runStore, artifactStore, driver, eventSink, options);
}
