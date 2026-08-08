import type { StepDisposition } from '../core/run.js';
import { parseBuildPlan } from './plan-build.js';

export function interpretWorkflowDisposition(
  disposition: string,
  value: unknown,
): { content: string; disposition?: StepDisposition } {
  if (disposition === 'build-plan') {
    const plan = parseBuildPlan(value);
    return {
      content: JSON.stringify(plan, null, 2),
      disposition:
        plan.decision === 'build'
          ? { kind: 'continue' }
          : {
              kind: 'stop',
              code: 'PLAN_NEEDS_CLARIFICATION',
              message: plan.clarificationQuestions.join(' '),
            },
    };
  }
  throw new Error(`Unknown output disposition: ${disposition}`);
}
