import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startProjectTransfer,
  previewProjectTransfer,
} from '../src/application/project-transfer.js';
import type { PortabilityService } from '../src/application/ports.js';
import { FileTransferJournal } from '../src/web/transfer-journal.js';
import type { ProjectCatalogEntry } from '../src/web/launcher-contracts.js';

const directories: string[] = [];
const sourceDeviceId = 'a'.repeat(64);
const targetDeviceId = 'b'.repeat(64);
const projectId = '123e4567-e89b-42d3-a456-426614174000';
const requestId = '123e4567-e89b-42d3-a456-426614174001';
const transferId = '123e4567-e89b-42d3-a456-426614174002';

function project(
  workspacePath: string,
  configPath: string,
  dataDirPath: string,
): ProjectCatalogEntry {
  return {
    projectId,
    name: 'Project',
    workspacePath,
    configPath,
    dataDirPath,
    ownership: { status: 'active', ownerDeviceId: sourceDeviceId },
    updatedAt: new Date().toISOString(),
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('project transfer', () => {
  it('performs a staged handoff and updates target config only after import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-project-transfer-'));
    directories.push(root);
    const sourceWorkspace = join(root, 'source-workspace');
    const targetWorkspace = join(root, 'target-workspace');
    await mkdir(join(sourceWorkspace, '.binaflow'), { recursive: true });
    await mkdir(join(targetWorkspace, '.binaflow'), { recursive: true });
    const targetConfig = join(targetWorkspace, '.binaflow', 'config.json');
    await writeFile(targetConfig, '{"dataDir":"./old-data","piCommand":"pi","profiles":{}}\n');
    const sourceConfig = join(sourceWorkspace, '.binaflow', 'config.json');
    await writeFile(sourceConfig, '{"dataDir":"./data","piCommand":"pi","profiles":{}}\n');
    const packagePath = join(root, 'source-package');
    const receivedPackagePath = join(root, 'received-package');
    const outputDataDir = join(root, 'new-data');
    const sourceProject = project(
      sourceWorkspace,
      sourceConfig,
      join(sourceWorkspace, '.binaflow', 'data'),
    );
    const targetProject = project(
      targetWorkspace,
      targetConfig,
      join(targetWorkspace, '.binaflow', 'old-data'),
    );
    const updateOwnership = vi.fn(async () => targetProject);
    const sourcePackage = 'portable package';
    const sourcePortability = {
      previewExport: async () => ({
        transferId,
        parentTransferId: null,
        datasetId: 'dataset',
        requestId,
        destination: packagePath,
        state: 'active',
        blockers: [],
        manifest: {
          files: { database: { sizeBytes: 1 }, bundle: { sizeBytes: 1 }, artifacts: [] },
        },
        digest: 'd'.repeat(64),
        sensitiveDataWarning: 'warning',
      }),
      exportPackage: async () => {
        await writeFile(packagePath, sourcePackage);
        return { transfer: {} as never, packagePath };
      },
    } as unknown as PortabilityService;
    const targetPortability = {
      previewImport: async () => ({
        transferId,
        datasetId: 'dataset',
        parentTransferId: null,
        outputDataDir,
        blockers: [],
        digest: 'e'.repeat(64),
        sensitiveDataWarning: 'warning',
      }),
      importPackage: async () => {
        await mkdir(outputDataDir, { recursive: true });
        return { transfer: { transferId } as never, dataDir: outputDataDir };
      },
    } as unknown as PortabilityService;
    const options = {
      transferId,
      requestId,
      source: {
        project: sourceProject,
        portability: sourcePortability,
        catalog: { updateOwnership } as never,
      },
      target: {
        project: targetProject,
        portability: targetPortability,
        catalog: { updateOwnership } as never,
      },
      packagePath,
      receivedPackagePath,
      outputDataDir,
      sourceDeviceId,
      targetDeviceId,
      journal: new FileTransferJournal(join(root, 'journal.json')),
    };
    const result = await startProjectTransfer(options);
    expect(result.stage).toBe('completed');
    expect(updateOwnership).toHaveBeenCalled();
    expect(await readFile(targetConfig, 'utf8')).toContain('new-data');
    expect(await readFile(receivedPackagePath, 'utf8')).toBe(sourcePackage);
  });

  it('blocks mismatched project identities before export', async () => {
    const projectA = project('/a', '/a/.binaflow/config.json', '/a/data');
    const projectB = { ...projectA, projectId: '123e4567-e89b-42d3-a456-426614174003' };
    await expect(
      previewProjectTransfer({
        transferId,
        requestId,
        source: { project: projectA, portability: {} as PortabilityService, catalog: {} as never },
        target: { project: projectB, portability: {} as PortabilityService, catalog: {} as never },
        packagePath: '/tmp/package',
        receivedPackagePath: '/tmp/received',
        outputDataDir: '/tmp/output',
        sourceDeviceId,
        targetDeviceId,
        journal: {} as never,
      }),
    ).rejects.toThrow(/differ/i);
  });
});
