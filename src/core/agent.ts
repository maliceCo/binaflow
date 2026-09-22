import type { AgentProfile } from './agent-profile.js';
import type { AgentStepResult } from './run.js';
import type { EventSink } from './events.js';

export interface AgentRequest {
  runId: string;
  stepId: string;
  profile: AgentProfile;
  prompt: string;
  /** Opaque external conversation identity to continue, when supported. */
  sessionId?: string;
}

export function composeAgentPrompt(prompt: string, profile: AgentProfile): string {
  const instructions = profile.instructions?.trim();
  if (!instructions) return prompt;
  return `${prompt}\n\nProject-specific agent instructions:\n${instructions}`;
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
