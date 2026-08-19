import type { RunStatus, StepRun } from '../core/run.js';

export function humanRunStatus(status: RunStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    case 'waiting':
      return 'Waiting for approval';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Interrupted';
  }
}

export function humanStepStatus(status: StepRun['status']): string {
  return status === 'skipped' ? 'Skipped' : humanRunStatus(status);
}

export function formatDurationMs(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0)
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(remainder).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
  return `${remainder}s`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number): string => String(part).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} UTC${offset}`;
}

export function formatRelativeTime(value: string, nowMs = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaSeconds = Math.round((nowMs - date.getTime()) / 1000);
  if (deltaSeconds < 0) return formatTimestamp(value);
  if (deltaSeconds < 60) return 'just now';
  if (deltaSeconds < 3600) {
    const minutes = Math.floor(deltaSeconds / 60);
    return `${minutes}m ago`;
  }
  if (deltaSeconds < 86400) {
    const hours = Math.floor(deltaSeconds / 3600);
    return `${hours}h ago`;
  }
  if (deltaSeconds < 86400 * 30) {
    const days = Math.floor(deltaSeconds / 86400);
    return `${days}d ago`;
  }
  return formatTimestamp(value);
}

export function formatBytes(sizeBytes: number): string {
  const bytes = Math.max(0, sizeBytes);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function truncateDisplay(value: string, maxChars: number): string {
  const limit = Math.max(1, maxChars);
  if (value.length <= limit) return value;
  if (limit <= 1) return '…';
  return `${value.slice(0, limit - 1)}…`;
}

export function runStatusColor(
  status: RunStatus | StepRun['status'],
): 'green' | 'red' | 'yellow' | 'cyan' | 'gray' | undefined {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'waiting':
    case 'running':
    case 'pending':
      return 'yellow';
    case 'cancelled':
    case 'interrupted':
    case 'skipped':
      return 'gray';
    default:
      return undefined;
  }
}

/** Turn a raw failure into a short explanation plus a practical next step when possible. */
export function explainUserError(message: string): string {
  const text = message.trim();
  if (!text) return 'Something went wrong. Press q to go back, or r to retry when available.';
  const lower = text.toLowerCase();
  if (lower.includes('no such run') || lower.includes('run not found')) {
    return `${text} Open Run history and pick another run.`;
  }
  if (lower.includes('config') && (lower.includes('invalid') || lower.includes('missing'))) {
    return `${text} Open Diagnosis or recreate configuration from home.`;
  }
  if (lower.includes('missing profile')) {
    return `${text} Fix agent profiles in configuration, then refresh diagnosis.`;
  }
  if (lower.includes('pi') && (lower.includes('not found') || lower.includes('launch'))) {
    return `${text} Install or fix the Pi command, then press r to refresh.`;
  }
  if (lower.includes('permission') || lower.includes('eacces')) {
    return `${text} Check workspace permissions, then retry.`;
  }
  if (lower.includes('cancel')) {
    return `${text} Return home or open Run history to inspect the run.`;
  }
  if (!/[.!?]$/.test(text)) return `${text}. Press q to go back.`;
  return `${text} Press q to go back.`;
}
