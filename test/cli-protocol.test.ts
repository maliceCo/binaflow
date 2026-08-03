import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCli } from '../src/cli/index.js';
import { listWorkflowContracts } from '../src/workflows/catalog.js';

describe('CLI protocol', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a versioned JSON workflow contract without opening workspace storage', async () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    await createCli().parseAsync(['node', 'binaflow', '--json', 'workflows']);

    const result = JSON.parse(output) as {
      protocol: string;
      version: number;
      type: string;
      command: string;
      data: { workflows: Array<{ id: string; input: unknown; requiredProfiles: string[] }> };
    };
    expect(result).toMatchObject({
      protocol: 'binaflow-cli',
      version: 1,
      type: 'result',
      command: 'workflows',
    });
    expect(result.data.workflows).toHaveLength(2);
    expect(result.data.workflows[0]).toHaveProperty('input');
    expect(result.data.workflows[0]?.requiredProfiles.length).toBeGreaterThan(0);
  });

  it('describes the same workflow contracts used by execution', () => {
    const contracts = listWorkflowContracts();

    expect(contracts.map((workflow) => workflow.id)).toEqual(['plan-build', 'research-plan-build']);
    expect(contracts.find((workflow) => workflow.id === 'plan-build')?.steps).toEqual([
      expect.objectContaining({ id: 'plan', profile: 'planner' }),
      expect.objectContaining({ id: 'build', profile: 'builder' }),
    ]);
  });
});
