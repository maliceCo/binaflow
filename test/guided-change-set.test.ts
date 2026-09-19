import { describe, expect, it } from 'vitest';
import {
  CHANGE_SET_VERSION,
  ChangeSetContractError,
  createChangeSet,
  parseChangeSet,
  transitionChangeSet,
} from '../src/application/change-set.js';

function file() {
  return {
    path: 'src/example.ts',
    status: 'modified' as const,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: 'context' as const, text: 'const oldValue = 1;', oldLine: 1, newLine: 1 },
          { kind: 'addition' as const, text: 'const newValue = 2;', newLine: 2 },
        ],
      },
    ],
  };
}

describe('ChangeSet contract', () => {
  it('creates a deterministic versioned review set without workspace data', () => {
    const value = createChangeSet({
      id: 'changes-1',
      runId: 'guided-run',
      contractId: 'contract-1',
      revision: 1,
      base: { branch: 'main', commit: 'base' },
      result: { branch: 'main', commit: 'head' },
      files: [file()],
    });

    expect(value).toMatchObject({
      version: CHANGE_SET_VERSION,
      status: 'review',
      id: 'changes-1',
      files: [file()],
    });
    expect(value.digest).toHaveLength(64);
    expect(JSON.stringify(value)).not.toContain('/workspace');
  });

  it('rejects unsafe paths, invalid hunks, and unknown fields', () => {
    expect(() =>
      createChangeSet({
        id: 'changes-1',
        runId: 'run',
        contractId: 'contract',
        revision: 1,
        base: { branch: 'main', commit: 'base' },
        result: { branch: 'main', commit: 'head' },
        files: [{ ...file(), path: '../secret' }],
      }),
    ).toThrow(ChangeSetContractError);

    expect(() => parseChangeSet({ version: 1, unexpected: true })).toThrow(ChangeSetContractError);
    expect(() =>
      parseChangeSet({
        ...createChangeSet({
          id: 'changes-1',
          runId: 'run',
          contractId: 'contract',
          revision: 1,
          base: { branch: 'main', commit: 'base' },
          result: { branch: 'main', commit: 'head' },
          files: [file()],
        }),
        files: [{ ...file(), secret: 'value' }],
      }),
    ).toThrow(ChangeSetContractError);
    expect(() =>
      transitionChangeSet(
        createChangeSet({
          id: 'changes-1',
          runId: 'run',
          contractId: 'contract',
          revision: 1,
          base: { branch: 'main', commit: 'base' },
          result: { branch: 'main', commit: 'head' },
          files: [file()],
        }),
        'applied',
      ),
    ).toThrow(ChangeSetContractError);
  });

  it('preserves the contract when parsing a created value', () => {
    const value = createChangeSet({
      id: 'changes-1',
      runId: 'run',
      contractId: 'contract',
      revision: 1,
      base: { branch: 'main', commit: 'base' },
      result: { branch: 'main', commit: 'head' },
      files: [file()],
    });
    expect(parseChangeSet(value)).toEqual(value);
    expect(transitionChangeSet(value, 'approved').status).toBe('approved');
  });
});
