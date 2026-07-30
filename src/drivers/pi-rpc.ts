import type { AgentDriver, AgentRequest } from '../core/agent.js';
import type { AgentUsage, AgentStepResult } from '../core/run.js';
import type { EventSink } from '../core/events.js';
import { JsonlProcess, type JsonObject } from '../process/jsonl-process.js';
import { AgentDriverError } from './contract.js';

export interface PiDriverOptions {
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  sessionDir?: string;
}

export class PiDriver implements AgentDriver {
  constructor(private readonly options: PiDriverOptions = {}) {}

  async execute(
    request: AgentRequest,
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<AgentStepResult> {
    validateProfile(request);
    const processOptions = {
      command: this.options.command ?? 'pi',
      args: [...(this.options.commandArgs ?? []), ...buildPiArgs(request, this.options.sessionDir)],
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      ...(this.options.env ? { env: this.options.env } : {}),
    };
    const process = new JsonlProcess(processOptions);
    const textParts: string[] = [];
    let finalText: string | undefined;
    let terminalError: string | undefined;
    let settle: (() => void) | undefined;
    let rejectSettle: ((error: Error) => void) | undefined;
    const settled = new Promise<void>((resolve, reject) => {
      settle = resolve;
      rejectSettle = reject;
    });
    let abortSent = false;
    const sendAbort = () => {
      if (abortSent) return;
      abortSent = true;
      try {
        process.send({ type: 'abort' });
      } catch {
        // The process may already have terminated.
      }
    };
    const abortListener = () => {
      sendAbort();
      rejectSettle?.(new AgentDriverError('Pi execution cancelled', 'PI_CANCELLED'));
    };
    const removeListener = process.onMessage((message) => {
      void normalizePiEvent(message, request, emit, textParts).then((event) => {
        if (event.text) finalText = event.text;
        if (event.error) terminalError = event.error;
        if (event.settled) settle?.();
      });
    });
    signal.addEventListener('abort', abortListener, { once: true });

    try {
      await process.request(
        { type: 'prompt', message: request.prompt },
        { timeoutMs: request.profile.timeoutMs, signal },
      );
      await waitForSettled(settled, request.profile.timeoutMs, sendAbort, signal);
      if (terminalError) throw new AgentDriverError(terminalError, 'PI_AGENT_ERROR', true);

      const state = await process.request(
        { type: 'get_state' },
        { timeoutMs: request.profile.timeoutMs },
      );
      const stats = await process.request(
        { type: 'get_session_stats' },
        { timeoutMs: request.profile.timeoutMs },
      );
      const result: AgentStepResult = { text: finalText ?? textParts.join('') };
      const sessionId = readSessionId(state);
      const usage = readUsage(stats);
      const costUsd = readCost(stats);
      if (sessionId) result.sessionId = sessionId;
      if (usage) result.usage = usage;
      if (costUsd !== undefined) result.costUsd = costUsd;
      return result;
    } catch (error) {
      if (signal.aborted) {
        sendAbort();
        throw new AgentDriverError('Pi execution cancelled', 'PI_CANCELLED');
      }
      if (error instanceof AgentDriverError) throw error;
      if (error instanceof Error && error.message.includes('timed out')) {
        sendAbort();
        throw new AgentDriverError('Pi execution timed out', 'PI_TIMEOUT', true);
      }
      throw new AgentDriverError(
        `Pi RPC failed: ${error instanceof Error ? error.message : String(error)}`,
        'PI_RPC_FAILED',
        true,
      );
    } finally {
      signal.removeEventListener('abort', abortListener);
      removeListener();
      await process.terminate();
    }
  }
}

function buildPiArgs(request: AgentRequest, sessionDir?: string): string[] {
  const args = [
    '--mode',
    'rpc',
    '--model',
    request.profile.model,
    '--name',
    `binaflow-${request.runId}-${request.stepId}`,
  ];
  if (request.profile.provider) args.push('--provider', request.profile.provider);
  if (request.profile.thinking) args.push('--thinking', request.profile.thinking);
  if (request.profile.tools.length > 0) args.push('--tools', request.profile.tools.join(','));
  else args.push('--no-tools');
  if (request.profile.workspaceMode === 'read-only') args.push('--no-approve');
  if (sessionDir) args.push('--session-dir', sessionDir);
  return args;
}

function validateProfile(request: AgentRequest): void {
  if (request.profile.driver !== 'pi') {
    throw new AgentDriverError(
      `PiDriver cannot execute profile driver: ${request.profile.driver}`,
      'PI_INVALID_PROFILE',
    );
  }
  if (!request.profile.model.trim()) {
    throw new AgentDriverError('Pi profile requires a model', 'PI_INVALID_PROFILE');
  }
  if (
    request.profile.workspaceMode === 'read-only' &&
    request.profile.tools.some((tool) => tool === 'write' || tool === 'edit' || tool === 'bash')
  ) {
    throw new AgentDriverError(
      'Read-only Pi profiles cannot enable write or edit tools',
      'PI_INVALID_PROFILE',
    );
  }
}

async function normalizePiEvent(
  message: JsonObject,
  request: AgentRequest,
  emit: EventSink,
  textParts: string[],
): Promise<{ text?: string; error?: string; settled?: boolean }> {
  if (message.type === 'agent_settled') {
    await emitStatus(request, emit, 'Pi agent settled');
    return { settled: true };
  }
  if (message.type === 'message_update') {
    const delta = asRecord(message.assistantMessageEvent);
    if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
      textParts.push(delta.delta);
      await emit({ ...eventBase(request), type: 'text', message: delta.delta });
    }
    if (delta?.type === 'error') {
      const error = typeof delta.reason === 'string' ? delta.reason : 'Pi assistant error';
      await emit({ ...eventBase(request), type: 'error', message: error });
      return { error };
    }
  }
  if (message.type === 'message_end') {
    const text = readMessageText(message.message);
    if (text) return { text };
  }
  if (message.type === 'extension_error') {
    const error = String(message.error ?? 'Pi extension error');
    await emit({ ...eventBase(request), type: 'error', message: error });
    return { error };
  }
  if (message.type === 'tool_execution_start' || message.type === 'tool_execution_end') {
    await emitStatus(request, emit, `Pi ${message.type}`);
  }
  return {};
}

function eventBase(request: AgentRequest): { runId: string; stepId: string; occurredAt: string } {
  return { runId: request.runId, stepId: request.stepId, occurredAt: new Date().toISOString() };
}

async function emitStatus(request: AgentRequest, emit: EventSink, message: string): Promise<void> {
  await emit({ ...eventBase(request), type: 'status', message });
}

function readMessageText(value: unknown): string | undefined {
  const message = asRecord(value);
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      const record = asRecord(part);
      return record?.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .join('');
  return text || undefined;
}

function readSessionId(response: JsonObject): string | undefined {
  const data = asRecord(response.data);
  return data && typeof data.sessionId === 'string' ? data.sessionId : undefined;
}

function readUsage(response: JsonObject): AgentUsage | undefined {
  const data = asRecord(response.data);
  const tokens = asRecord(data?.tokens);
  if (!tokens) return undefined;
  const usage: AgentUsage = {};
  const inputTokens = numberValue(tokens.input);
  const outputTokens = numberValue(tokens.output);
  const totalTokens = numberValue(tokens.total);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  return usage;
}

function readCost(response: JsonObject): number | undefined {
  const data = asRecord(response.data);
  return numberValue(data?.cost);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asRecord(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

async function waitForSettled(
  settled: Promise<void>,
  timeoutMs: number,
  sendAbort: () => void,
  signal: AbortSignal,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      settled,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          sendAbort();
          reject(new AgentDriverError('Pi execution timed out', 'PI_TIMEOUT', true));
        }, timeoutMs);
      }),
      signal.aborted
        ? Promise.reject(new AgentDriverError('Pi execution cancelled', 'PI_CANCELLED'))
        : new Promise<never>(() => undefined),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
