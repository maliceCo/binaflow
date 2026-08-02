export type NormalizedEventType = 'status' | 'text' | 'error';

export interface NormalizedEvent {
  runId: string;
  stepId: string;
  type: NormalizedEventType;
  message: string;
  occurredAt: string;
}

export type EventSink = (event: NormalizedEvent) => Promise<void> | void;
