import type { StepDisposition } from '../core/run.js';
import { parseBuildPlan } from './plan-build.js';
import { parsePlanBuildQaScope } from './plan-build-qa.js';

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
  if (disposition === 'plan-build-qa-scope') {
    const scope = parsePlanBuildQaScope(value);
    return {
      content: JSON.stringify(scope, null, 2),
      disposition:
        scope.decision === 'proceed'
          ? { kind: 'continue' }
          : {
              kind: 'stop',
              code: 'SCOPE_NEEDS_CLARIFICATION',
              message: scope.questions.join(' '),
            },
    };
  }
  throw new Error(`Unknown output disposition: ${disposition}`);
}
