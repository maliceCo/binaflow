import { describe, expect, it } from 'vitest';
import {
  buildGuidedPreparationPrompt,
  GuidedPreparationError,
  parseGuidedPlanOutput,
  parseGuidedPreparationOperation,
  parseGuidedReplyOutput,
  validateGuidedPlannerProfile,
  type GuidedPreparationPromptInput,
} from '../src/application/guided-preparation.js';

const contractId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const brief = {
  objective: 'Prepare a small change',
  conclusions: ['The change is local'],
  constraints: ['Keep the CLI stable'],
  outOfScope: ['Deployment'],
};

const validReplyRequest = {
  schemaVersion: 1,
  requestId,
  contractId,
  expectedRevision: 1,
  kind: 'reply',
  message: 'Please clarify the acceptance criteria.',
  sourceIds: [sourceId],
} as const;

describe('guided preparation contracts', () => {
  it('parses a strict operation and planner reply', () => {
    expect(parseGuidedPreparationOperation(validReplyRequest)).toEqual(validReplyRequest);
    expect(
      parseGuidedReplyOutput({
        schemaVersion: 1,
        kind: 'message',
        message: 'The scope is clear.',
        questions: [],
        citedSourceIds: [sourceId],
      }),
    ).toMatchObject({ kind: 'message', citedSourceIds: [sourceId] });
  });

  it('rejects invalid versions, extra fields, and invented source IDs', () => {
    expect(() =>
      parseGuidedPreparationOperation({ ...validReplyRequest, schemaVersion: 2 }),
    ).toThrow(GuidedPreparationError);
    expect(() =>
      parseGuidedPreparationOperation({ ...validReplyRequest, unexpected: true }),
    ).toThrow(GuidedPreparationError);
    expect(() =>
      parseGuidedPreparationOperation({
        ...validReplyRequest,
        sourceIds: ['not-a-uuid'],
      }),
    ).toThrow(GuidedPreparationError);
  });

  it('reuses the task contract parser for plan output', () => {
    expect(
      parseGuidedPlanOutput({
        schemaVersion: 1,
        kind: 'plan',
        citedSourceIds: [],
        plan: {
          briefVersion: 1,
          summary: 'Implement the change',
          items: [
            {
              id: 'one',
              title: 'Implement',
              description: 'Make the requested change.',
              files: [{ path: 'src/example.ts', reason: 'Implementation' }],
              acceptanceCriteria: ['The behavior is covered'],
            },
          ],
          verification: ['Run the focused tests'],
        },
      }),
    ).toMatchObject({ kind: 'plan' });
  });

  it('enforces the read-only planner profile and prompt size', () => {
    expect(() =>
      validateGuidedPlannerProfile({
        driver: 'pi',
        model: 'planner',
        tools: ['bash'],
        workspaceMode: 'read-only',
        projectTrust: 'never',
        timeoutMs: 1000,
        retryLimit: 0,
        skills: { mode: 'none' },
      }),
    ).toThrow(/planner profile/i);

    const input: GuidedPreparationPromptInput = {
      brief,
      messages: [{ id: requestId, sequence: 1, role: 'user', content: 'x'.repeat(100_000) }],
      sources: [],
      instruction: 'Summarize the confirmed context.',
    };
    expect(() => buildGuidedPreparationPrompt(input)).toThrow(/size limit/i);
  });
});
