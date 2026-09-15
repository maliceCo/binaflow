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
  constructor(private readonly journalPath: string) {}

  async get(transferId: string): Promise<TransferJournalRecord | undefined> {
    const records = await this.read();
    return records.find((record) => record.transferId === transferId);
  }

  async save(record: TransferJournalRecord): Promise<void> {
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
  }

  private async read(): Promise<TransferJournalRecord[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.journalPath, 'utf8'));
      if (!Array.isArray(value)) throw new Error('Transfer journal must be an array');
      return value as TransferJournalRecord[];
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw new Error(`Cannot load transfer journal ${this.journalPath}`);
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
