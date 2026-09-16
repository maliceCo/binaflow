import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTransferJournal } from '../src/web/transfer-journal.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('transfer journal', () => {
  it('atomically persists one resumable record per transfer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-transfer-journal-'));
    directories.push(directory);
    const journal = new FileTransferJournal(join(directory, 'transfers.json'));
    const record = {
      transferId: '123e4567-e89b-42d3-a456-426614174000',
      projectId: '123e4567-e89b-42d3-a456-426614174001',
      sourceDeviceId: 'a'.repeat(64),
      targetDeviceId: 'b'.repeat(64),
      stage: 'sending' as const,
      requestId: '123e4567-e89b-42d3-a456-426614174002',
      packageDigest: 'c'.repeat(64),
      bytesSent: 10,
      bytesReceived: 0,
      updatedAt: new Date().toISOString(),
    };
    await journal.save(record);
    await journal.save({ ...record, stage: 'completed', bytesReceived: 10 });
    await Promise.all([
      journal.save({ ...record, transferId: 'transfer-a' }),
      journal.save({ ...record, transferId: 'transfer-b' }),
    ]);
    expect(await journal.get(record.transferId)).toMatchObject({
      stage: 'completed',
      bytesReceived: 10,
    });
    expect(await journal.get('transfer-a')).toMatchObject({ transferId: 'transfer-a' });
    expect(await journal.get('transfer-b')).toMatchObject({ transferId: 'transfer-b' });
  });
});
