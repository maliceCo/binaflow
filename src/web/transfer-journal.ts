import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type TransferJournalStage =
  'preflight' | 'exporting' | 'sending' | 'importing' | 'completed' | 'failed' | 'interrupted';

export interface TransferJournalRecord {
  transferId: string;
  projectId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  stage: TransferJournalStage;
  requestId: string;
  packageDigest: string;
  packagePath?: string;
  receivedPackagePath?: string;
  bytesSent: number;
  bytesReceived: number;
  sourceReceipt?: string;
  targetReceipt?: string;
  updatedAt: string;
  errorCode?: string;
}

export class FileTransferJournal {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly journalPath: string) {}

  async get(transferId: string): Promise<TransferJournalRecord | undefined> {
    await this.mutationQueue;
    const records = await this.read();
    return records.find((record) => record.transferId === transferId);
  }

  save(record: TransferJournalRecord): Promise<void> {
    return this.enqueue(async () => {
      const records = await this.read();
      const next = records.filter((item) => item.transferId !== record.transferId);
      next.push(record);
      await mkdir(dirname(this.journalPath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.journalPath}.${process.pid}-${Date.now()}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        await rename(temporaryPath, this.journalPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<TransferJournalRecord[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.journalPath, 'utf8'));
      if (!Array.isArray(value)) throw new Error('Transfer journal must be an array');
      return value.map(parseJournalRecord);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw new Error(`Cannot load transfer journal ${this.journalPath}`);
    }
  }
}

function parseJournalRecord(value: unknown): TransferJournalRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Transfer journal record is invalid');
  }
  const record = value as Record<string, unknown>;
  const stages: TransferJournalStage[] = [
    'preflight',
    'exporting',
    'sending',
    'importing',
    'completed',
    'failed',
    'interrupted',
  ];
  if (
    typeof record.transferId !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.sourceDeviceId !== 'string' ||
    typeof record.targetDeviceId !== 'string' ||
    typeof record.requestId !== 'string' ||
    typeof record.packageDigest !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    !stages.includes(record.stage as TransferJournalStage) ||
    !nonNegativeInteger(record.bytesSent) ||
    !nonNegativeInteger(record.bytesReceived) ||
    !optionalString(record.packagePath) ||
    !optionalString(record.receivedPackagePath) ||
    !optionalString(record.sourceReceipt) ||
    !optionalString(record.targetReceipt) ||
    !optionalString(record.errorCode)
  ) {
    throw new Error('Transfer journal record is invalid');
  }
  return record as unknown as TransferJournalRecord;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
