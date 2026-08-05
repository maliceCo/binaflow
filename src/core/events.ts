export type NormalizedEventType = 'status' | 'text' | 'error';

export interface NormalizedEvent {
  runId: string;
  stepId: string;
  type: NormalizedEventType;
  message: string;
  occurredAt: string;
}

export interface EventSink {
  (event: NormalizedEvent): Promise<void> | void;
  flush?: () => Promise<void>;
}
