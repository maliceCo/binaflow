export const READ_ONLY_PI_TOOLS = ['ls', 'find', 'read'] as const;

const READ_ONLY_PI_TOOL_SET = new Set<string>(READ_ONLY_PI_TOOLS);

export function isReadOnlyPiTool(tool: string): boolean {
  return READ_ONLY_PI_TOOL_SET.has(tool);
}
