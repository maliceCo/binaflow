import type { ConfigurationDiagnosis } from '../../application/config-operations.js';
import { discoverWorkflows, supportForWorkflowSurface } from '../../application/operations.js';
import { missingProfiles, orderedWorkflows } from '../launch.js';
export function workflowItems(
  workflows: ReturnType<typeof discoverWorkflows>,
  diagnosis?: ConfigurationDiagnosis | undefined,
): string[] {
  return orderedWorkflows(workflows).map((workflow) => {
    const missing = diagnosis ? missingProfiles(workflow, diagnosis) : [];
    const support = supportForWorkflowSurface(workflow.id, 'tui');
    const label = `${workflow.id}${workflow.experimental ? ' [Experimental]' : ''} [Direct/legacy] (${support?.mode ?? 'unsupported'}): ${workflow.description}`;
    return missing.length > 0 ? `${label} (missing: ${missing.join(', ')})` : label;
  });
}
