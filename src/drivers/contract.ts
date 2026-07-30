export type { AgentDriver, AgentRequest } from '../core/agent.js';

export class AgentDriverError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
