import { createHash } from 'node:crypto';

export const CHANGE_SET_VERSION = 1 as const;
export const CHANGE_SET_MAX_FILES = 1_000 as const;
export const CHANGE_SET_MAX_HUNKS = 10_000 as const;
export const CHANGE_SET_MAX_LINES_PER_HUNK = 20_000 as const;
export const CHANGE_SET_MAX_LINE_BYTES = 65_536 as const;

export type ChangeSetStatus = 'review' | 'approved' | 'rejected' | 'superseded' | 'applied';
export type ChangeSetFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export type ChangeSetLineKind = 'context' | 'addition' | 'deletion';

export interface ChangeSetCommit {
  branch: string;
  commit: string;
}

export interface ChangeSetLine {
  kind: ChangeSetLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ChangeSetHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: ChangeSetLine[];
}

export interface ChangeSetFile {
  path: string;
  status: ChangeSetFileStatus;
  oldPath?: string;
  binary?: boolean;
  hunks: ChangeSetHunk[];
}

export interface ChangeSet {
  version: typeof CHANGE_SET_VERSION;
  id: string;
  runId: string;
  contractId: string;
  revision: number;
  status: ChangeSetStatus;
  base: ChangeSetCommit;
  result: ChangeSetCommit;
  files: ChangeSetFile[];
  digest: string;
}

export type ChangeSetInput = Omit<ChangeSet, 'version' | 'status' | 'digest'> & {
  status?: ChangeSetStatus;
};

export class ChangeSetContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeSetContractError';
  }
}

export function createChangeSet(input: ChangeSetInput): ChangeSet {
  const candidate: ChangeSet = {
    version: CHANGE_SET_VERSION,
    id: input.id,
    runId: input.runId,
    contractId: input.contractId,
    revision: input.revision,
    status: input.status ?? 'review',
    base: input.base,
    result: input.result,
    files: input.files.map((file) => ({
      ...file,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      ...(file.binary === undefined ? {} : { binary: file.binary }),
      hunks: file.hunks.map((hunk) => ({
        ...hunk,
        lines: hunk.lines.map((line) => ({ ...line })),
      })),
    })),
    digest: '',
  };
  validateChangeSet(candidate, false);
  candidate.files.sort((left, right) => left.path.localeCompare(right.path));
  candidate.digest = digestWithoutDigest(candidate);
  return candidate;
}

export function parseChangeSet(value: unknown): ChangeSet {
  if (!isRecord(value) || Object.keys(value).some((key) => !CHANGE_SET_KEYS.has(key))) {
    throw new ChangeSetContractError('Invalid ChangeSet object');
  }
  const candidate = value as unknown as ChangeSet;
  validateChangeSet(candidate, true);
  if (candidate.digest !== digestWithoutDigest(candidate)) {
    throw new ChangeSetContractError('ChangeSet digest does not match its content');
  }
  return candidate;
}

export function transitionChangeSet(changeSet: ChangeSet, status: ChangeSetStatus): ChangeSet {
  const allowed: Record<ChangeSetStatus, readonly ChangeSetStatus[]> = {
    review: ['approved', 'rejected', 'superseded'],
    approved: ['applied', 'superseded'],
    rejected: [],
    superseded: [],
    applied: [],
  };
  if (!allowed[changeSet.status].includes(status)) {
    throw new ChangeSetContractError(
      `Invalid ChangeSet transition: ${changeSet.status} -> ${status}`,
    );
  }
  return createChangeSet({ ...changeSet, status });
}

function validateChangeSet(value: ChangeSet, requireDigest: boolean): void {
  if (value.version !== CHANGE_SET_VERSION)
    throw new ChangeSetContractError('Unsupported ChangeSet version');
  for (const [name, field] of [
    ['id', value.id],
    ['runId', value.runId],
    ['contractId', value.contractId],
  ] as const) {
    if (typeof field !== 'string' || !field.trim()) {
      throw new ChangeSetContractError(`${name} must be a non-empty string`);
    }
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new ChangeSetContractError('revision must be a positive integer');
  }
  if (!['review', 'approved', 'rejected', 'superseded', 'applied'].includes(value.status)) {
    throw new ChangeSetContractError('Invalid ChangeSet status');
  }
  validateCommit(value.base, 'base');
  validateCommit(value.result, 'result');
  if (!Array.isArray(value.files) || value.files.length > CHANGE_SET_MAX_FILES) {
    throw new ChangeSetContractError('Invalid ChangeSet files');
  }
  const paths = new Set<string>();
  let hunkCount = 0;
  for (const file of value.files) {
    if (!isRecord(file) || !hasOnlyKeys(file, ['path', 'status', 'oldPath', 'binary', 'hunks'])) {
      throw new ChangeSetContractError(`Invalid ChangeSet file: ${String(file.path)}`);
    }
    validatePath(file.path);
    if (paths.has(file.path))
      throw new ChangeSetContractError(`Duplicate ChangeSet path: ${file.path}`);
    paths.add(file.path);
    if (!['added', 'modified', 'deleted', 'renamed'].includes(file.status)) {
      throw new ChangeSetContractError(`Invalid ChangeSet file status: ${file.path}`);
    }
    if (file.oldPath !== undefined) validatePath(file.oldPath);
    if (file.status === 'renamed' && !file.oldPath) {
      throw new ChangeSetContractError(`Renamed file requires oldPath: ${file.path}`);
    }
    if (file.binary !== undefined && typeof file.binary !== 'boolean') {
      throw new ChangeSetContractError(`Invalid binary flag: ${file.path}`);
    }
    if (!Array.isArray(file.hunks)) throw new ChangeSetContractError(`Invalid hunks: ${file.path}`);
    hunkCount += file.hunks.length;
    for (const hunk of file.hunks) validateHunk(hunk, file.path);
  }
  if (hunkCount > CHANGE_SET_MAX_HUNKS)
    throw new ChangeSetContractError('ChangeSet hunk limit exceeded');
  if (requireDigest && typeof value.digest !== 'string') {
    throw new ChangeSetContractError('ChangeSet digest is required');
  }
}

function validateCommit(value: ChangeSetCommit, name: string): void {
  if (!isRecord(value) || !hasOnlyKeys(value, ['branch', 'commit'])) {
    throw new ChangeSetContractError(`Invalid ${name} commit`);
  }
  if (typeof value.branch !== 'string' || typeof value.commit !== 'string') {
    throw new ChangeSetContractError(`Invalid ${name} commit`);
  }
  if (!value.branch || !value.commit) throw new ChangeSetContractError(`Invalid ${name} commit`);
}

function validateHunk(value: ChangeSetHunk, path: string): void {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['oldStart', 'oldLines', 'newStart', 'newLines', 'lines'])
  ) {
    throw new ChangeSetContractError(`Invalid hunk: ${path}`);
  }
  if (
    ![value.oldStart, value.oldLines, value.newStart, value.newLines].every(
      (item) => Number.isSafeInteger(item) && (item as number) >= 0,
    ) ||
    !Array.isArray(value.lines) ||
    value.lines.length > CHANGE_SET_MAX_LINES_PER_HUNK
  ) {
    throw new ChangeSetContractError(`Invalid hunk: ${path}`);
  }
  for (const line of value.lines) {
    if (
      !isRecord(line) ||
      !hasOnlyKeys(line, ['kind', 'text', 'oldLine', 'newLine']) ||
      !['context', 'addition', 'deletion'].includes(String(line.kind))
    ) {
      throw new ChangeSetContractError(`Invalid diff line: ${path}`);
    }
    if (
      typeof line.text !== 'string' ||
      Buffer.byteLength(line.text, 'utf8') > CHANGE_SET_MAX_LINE_BYTES
    ) {
      throw new ChangeSetContractError(`Invalid diff line text: ${path}`);
    }
    for (const number of [line.oldLine, line.newLine]) {
      if (number !== undefined && (!Number.isSafeInteger(number) || number < 1)) {
        throw new ChangeSetContractError(`Invalid diff line number: ${path}`);
      }
    }
  }
}

function validatePath(value: string): void {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    value === '.git' ||
    value.startsWith('.git/') ||
    value === '.binaflow' ||
    value.startsWith('.binaflow/')
  ) {
    throw new ChangeSetContractError(`Unsafe ChangeSet path: ${String(value)}`);
  }
}

function digestWithoutDigest(value: ChangeSet): string {
  const { digest, ...withoutDigest } = value;
  void digest;
  return createHash('sha256').update(stableJson(withoutDigest)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

const CHANGE_SET_KEYS = new Set([
  'version',
  'id',
  'runId',
  'contractId',
  'revision',
  'status',
  'base',
  'result',
  'files',
  'digest',
]);
