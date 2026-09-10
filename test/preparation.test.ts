import { describe, expect, it } from 'vitest';
import {
  createPreparationProposal,
  parsePreparationAgentResponse,
  validatePreparationProposal,
} from '../src/application/preparation.js';
import { createPreparation, replyPreparation } from '../src/application/preparation-operations.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const profile = {
  driver: 'fake',
  model: 'test',
  tools: [],
  workspaceMode: 'read-only' as const,
  timeoutMs: 1000,
  retryLimit: 0,
};
const plannerProfile = { ...profile, driver: 'pi' as const };

const plan = {
  decision: 'build' as const,
  summary: 'Implement the request',
  tasks: [
    {
      id: 'task-1',
      title: 'Implement',
      description: 'Implement the request',
      files: ['src/example.ts'],
      acceptanceCriteria: ['It works'],
    },
  ],
  verification: ['pnpm test'],
  risks: [],
  clarificationQuestions: [],
};

describe('preparation contracts', () => {
  it('allows incomplete ideas as messages but requires a definitive objective for proposals', () => {
    expect(
      parsePreparationAgentResponse({ kind: 'message', content: 'What should it do?' }),
    ).toEqual({
      kind: 'message',
      content: 'What should it do?',
    });
    expect(() =>
      createPreparationProposal({
        draftId: 'draft-1',
        revision: 1,
        workflowId: 'plan-build',
        workflowVersion: 1,
        objective: ' ',
        outputs: [{ stepId: 'plan', name: 'plan', value: plan }],
        provenance: { profile: 'planner', profileSnapshot: profile },
      }),
    ).toThrow('objective');
  });

  it('accepts a validated executable proposal and freezes its contents', () => {
    const proposal = createPreparationProposal({
      draftId: 'draft-1',
      revision: 2,
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Add the feature',
      outputs: [{ stepId: 'plan', name: 'plan', value: plan }],
      provenance: { profile: 'planner', profileSnapshot: profile },
    });
    expect(proposal.outputs[0]?.value).toEqual(plan);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(proposal.outputs[0])).toBe(true);
  });

  it('rejects clarification plans and authorization fields', () => {
    expect(() =>
      parsePreparationAgentResponse({ kind: 'message', content: 'ok', approved: true }),
    ).toThrow('authorization');
    expect(() =>
      validatePreparationProposal({
        draftId: 'draft-1',
        revision: 1,
        workflowId: 'plan-build',
        workflowVersion: 1,
        objective: 'Do it',
        outputs: [
          {
            stepId: 'plan',
            name: 'plan',
            value: {
              ...plan,
              decision: 'needs_clarification',
              tasks: [],
              clarificationQuestions: ['Which?'],
            },
          },
        ],
        provenance: { profile: 'planner', profileSnapshot: profile },
      }),
    ).toThrow('not executable');
  });

  it('keeps a conversational question separate from workflow execution', async () => {
    const store = new SqliteRunStore(':memory:');
    const context = {
      config: { profiles: { planner: plannerProfile } },
      preparationStore: store,
      preparationDriver: {
        execute: async () => ({ text: 'What behavior should change?' }),
      },
    };
    const preparation = await createPreparation(context, {
      workspace: 'E:/missing-binaflow-test-workspace',
      workflowId: 'plan-build',
    });
    const result = await replyPreparation(context, {
      draftId: preparation.draft.id,
      content: 'Improve this',
    });
    expect(result.response).toMatchObject({ role: 'assistant', generationStatus: 'sent' });
    expect(result.conversation.draft.objective).toBe('');
    store.close();
  });
});
