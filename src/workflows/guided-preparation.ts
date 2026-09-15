import {
  buildGuidedPreparationPrompt,
  GUIDED_PREPARATION_SCHEMA_VERSION,
  parseGuidedPlanOutput,
  parseGuidedReplyOutput,
  parseGuidedTodoOutput,
  type GuidedPreparationPromptInput,
  type GuidedPlanOutput,
  type GuidedReplyOutput,
  type GuidedTodoOutput,
} from '../application/guided-preparation.js';

export const GUIDED_PREPARATION_REPLY_SCHEMA_VERSION = GUIDED_PREPARATION_SCHEMA_VERSION;
export const GUIDED_PREPARATION_PLAN_SCHEMA_VERSION = GUIDED_PREPARATION_SCHEMA_VERSION;
export const GUIDED_PREPARATION_TODO_SCHEMA_VERSION = GUIDED_PREPARATION_SCHEMA_VERSION;

export function createGuidedReplyPrompt(input: GuidedPreparationPromptInput): string {
  return buildGuidedPreparationPrompt({
    ...input,
    instruction:
      `${input.instruction}\nReturn exactly one JSON object with schemaVersion 1, kind message, message, questions, ` +
      'optional briefSuggestion, and citedSourceIds.',
  });
}

export function parseGuidedReplyResult(value: unknown): GuidedReplyOutput {
  return parseGuidedReplyOutput(value);
}

export function parseGuidedPlanResult(value: unknown): GuidedPlanOutput {
  return parseGuidedPlanOutput(value);
}

export function parseGuidedTodoResult(value: unknown): GuidedTodoOutput {
  return parseGuidedTodoOutput(value);
}
