export interface StructuredOutputContract {
  name: string;
  schema?: unknown;
}

export function renderStructuredOutputInstructions(
  contracts: readonly StructuredOutputContract[],
): string {
  if (contracts.length === 0) return '';
  return [
    'Structured output contract:',
    'Return exactly one JSON object and no markdown or explanatory text.',
    ...contracts.map((contract) =>
      contract.schema
        ? `The complete JSON Schema for ${contract.name} is: ${JSON.stringify(contract.schema)}`
        : `The output for ${contract.name} must be one JSON object.`,
    ),
  ].join('\n');
}

export function renderStructuredOutputRepair(reason: string): string {
  return [
    'The previous response failed structured-output validation.',
    `Validation error: ${reason}`,
    'Return only one JSON object matching the structured output contract.',
  ].join('\n');
}
