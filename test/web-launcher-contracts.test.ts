import { describe, expect, it } from 'vitest';
import {
  LAUNCHER_LIMITS,
  parseDeviceRecord,
  parseLauncherSettings,
  parsePeerTransferReceipt,
  parsePeerTransferRequest,
  parseProjectCatalog,
  toWebDeviceSummaryDto,
  toWebProjectSummaryDto,
} from '../src/web/launcher-contracts.js';
import { WebContractError } from '../src/web/contracts.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const transferId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';
const sourceDeviceId = 'a'.repeat(64);
const targetDeviceId = 'b'.repeat(64);
const digest = 'c'.repeat(64);

const settings = {
  schemaVersion: 1,
  setupRequired: false,
  deviceName: 'Desktop',
  web: {
    host: '127.0.0.1',
    port: 4317,
    origin: 'http://127.0.0.1:4317',
  },
  projectRoots: [
    {
      rootId: '00000000-0000-4000-8000-000000000010',
      label: 'Projects',
      path: '/srv/projects',
    },
  ],
} as const;

const catalog = {
  schemaVersion: 1,
  projects: [
    {
      projectId,
      name: 'Binaflow',
      workspacePath: '/srv/projects/binaflow',
      configPath: '/srv/projects/binaflow/.binaflow/config.json',
      dataDirPath: '/srv/projects/binaflow/.binaflow/data',
      ownership: { status: 'active', ownerDeviceId: sourceDeviceId },
      updatedAt: '2026-03-22T10:00:00.000Z',
    },
  ],
} as const;

const device = {
  schemaVersion: 1,
  deviceId: targetDeviceId,
  name: 'Laptop',
  origin: 'https://laptop.example:4317',
  publicKey: '-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----\n',
  certificateFingerprint: digest,
  status: 'paired',
  pairedAt: '2026-03-22T10:00:00.000Z',
} as const;

const transferRequest = {
  schemaVersion: 1,
  transferId,
  requestId,
  projectId,
  sourceDeviceId,
  targetDeviceId,
  branch: 'main',
  headCommit: 'd'.repeat(40),
  packageDigest: digest,
  packageBytes: 1024,
} as const;

describe('web launcher contracts', () => {
  it('parses strict launcher, catalog, device, and transfer records', () => {
    expect(parseLauncherSettings(settings)).toEqual(settings);
    expect(parseProjectCatalog(catalog)).toEqual(catalog);
    expect(parseDeviceRecord(device)).toEqual(device);
    expect(parsePeerTransferRequest(transferRequest)).toEqual(transferRequest);
    expect(
      parsePeerTransferReceipt({
        schemaVersion: 1,
        transferId,
        requestId,
        projectId,
        sourceDeviceId,
        targetDeviceId,
        status: 'completed',
        packageDigest: digest,
        receivedBytes: 1024,
        completedAt: '2026-03-22T10:05:00.000Z',
      }),
    ).toMatchObject({ status: 'completed', receivedBytes: 1024 });
  });

  it('rejects unknown fields, invalid IDs, and impossible ownership records', () => {
    expect(() => parseLauncherSettings({ ...settings, extra: true })).toThrow(WebContractError);
    expect(() =>
      parseProjectCatalog({
        ...catalog,
        projects: [
          {
            ...catalog.projects[0],
            ownership: {
              status: 'exported',
              previousOwnerDeviceId: sourceDeviceId,
              transferId,
              targetDeviceId: sourceDeviceId,
            },
          },
        ],
      }),
    ).toThrow(WebContractError);
    expect(() => parseDeviceRecord({ ...device, deviceId: 'not-a-device-id' })).toThrow(
      WebContractError,
    );
    expect(() =>
      parsePeerTransferRequest({ ...transferRequest, projectId: 'not-a-project-id' }),
    ).toThrow(WebContractError);
  });

  it('enforces collection and UTF-8 limits', () => {
    expect(() =>
      parseLauncherSettings({
        ...settings,
        projectRoots: Array.from({ length: LAUNCHER_LIMITS.maxProjectRoots + 1 }, (_, index) => ({
          rootId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          label: `Root ${index}`,
          path: `/srv/projects/${index}`,
        })),
      }),
    ).toThrow(/limit/i);
    expect(() => parseDeviceRecord({ ...device, name: 'x'.repeat(1024) })).toThrow(/limit/i);
    expect(() =>
      parseProjectCatalog({
        ...catalog,
        projects: [catalog.projects[0], { ...catalog.projects[0], name: 'Duplicate' }],
      }),
    ).toThrow(/duplicate/i);
  });

  it('projects browser DTOs without local paths, keys, or certificates', () => {
    const projectDto = toWebProjectSummaryDto(parseProjectCatalog(catalog).projects[0]!);
    const deviceDto = toWebDeviceSummaryDto(parseDeviceRecord(device));
    const serialized = JSON.stringify({ projectDto, deviceDto });

    expect(projectDto).toMatchObject({ id: projectId, ownership: 'active' });
    expect(deviceDto).toEqual({ id: targetDeviceId, name: 'Laptop', status: 'paired' });
    expect(serialized).not.toContain('/srv/');
    expect(serialized).not.toContain('workspacePath');
    expect(serialized).not.toContain('configPath');
    expect(serialized).not.toContain('dataDirPath');
    expect(serialized).not.toContain('PUBLIC KEY');
    expect(serialized).not.toContain(digest);
  });
});
