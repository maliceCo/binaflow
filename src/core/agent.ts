import type { AgentProfile } from '../config.js';
import type { AgentStepResult } from './run.js';
import type { EventSink } from './events.js';

export interface AgentRequest {
  runId: string;
  stepId: string;
  profile: AgentProfile;
  prompt: string;
}

export interface AgentDriver {
  execute(request: AgentRequest, emit: EventSink, signal: AbortSignal): Promise<AgentStepResult>;
}

export interface AgentModel {
  provider: string;
  model: string;
  displayName?: string;
}

export interface AgentModelDiscovery {
  discoverModels(): Promise<AgentModel[]>;
}
