import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DeviceRecord } from './launcher-contracts.js';
import { parseDeviceRecord } from './launcher-contracts.js';

export class FileDeviceStore {
  constructor(private readonly path: string) {}

  load(): DeviceRecord[] {
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!Array.isArray(value)) throw new Error('Device store must be an array');
      return value.map(parseDeviceRecord);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw new Error(`Cannot load device store ${this.path}`);
    }
  }

  save(records: readonly DeviceRecord[]): void {
    const parsed = records.map(parseDeviceRecord);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}-${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.path);
      chmodSync(this.path, 0o600);
    } finally {
      rmSync(temporaryPath, { force: true });
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
