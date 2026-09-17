import { describe, expect, it } from 'vitest';
import {
  renderStructuredOutputInstructions,
  renderStructuredOutputRepair,
} from '../src/core/structured-output.js';

describe('structured output instructions', () => {
  it('renders the schema as part of the agent contract', () => {
    const prompt = renderStructuredOutputInstructions([
      {
        name: 'QA report',
        schema: {
          type: 'object',
          required: ['decision'],
          properties: { decision: { enum: ['pass', 'block'] } },
        },
      },
    ]);

    expect(prompt).toContain('Return exactly one JSON object');
    expect(prompt).toContain('The complete JSON Schema for QA report is:');
    expect(prompt).toContain('"decision"');
  });

  it('explains the validation failure during the single repair attempt', () => {
    expect(
      renderStructuredOutputRepair('decision must be equal to one of the allowed values'),
    ).toBe(
      'The previous response failed structured-output validation.\n' +
        'Validation error: decision must be equal to one of the allowed values\n' +
        'Return only one JSON object matching the structured output contract.',
    );
  });
});
