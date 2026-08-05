export interface WorkflowSummary {
  id: string;
  description: string;
  experimental?: boolean;
}

export const workflowSummaries: readonly WorkflowSummary[] = [
  {
    id: 'plan-build',
    description: 'Plan the work, then implement the validated plan',
  },
  {
    id: 'research-plan-build',
    description: 'Research the repository, review findings, then build',
    experimental: true,
  },
];
