import type { Command } from 'commander';
import type { ReviewTarget, ReviewTargetKind } from '../../core/interactive-review.js';
import { machineMode, rejectUnsupportedJsonl, writeJsonResult } from '../protocol.js';
import {
  openContext,
  openStorageContext,
  printMachineRunResult,
  printRunSummary,
  rootOptions,
  runAttachedCli,
} from './common.js';

export function registerReviewCommands(cli: Command): void {
  const review = cli
    .command('review')
    .description('Inspect and control an interactive review')
    .argument('<run-id>', 'interactive review run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      const mode = machineMode(rootOptions(command));
      rejectUnsupportedJsonl(mode, 'review');
      const context = await openStorageContext(rootOptions(command));
      try {
        const view = await context.application.getReview!(runId);
        if (mode) writeJsonResult('review', view);
        else printReview(view);
      } finally {
        context.close();
      }
    });

  review
    .command('message <run-id>')
    .requiredOption('--thread <id>', 'review thread ID')
    .requiredOption('--message <text>', 'message visible to the review')
    .action(
      async (runId: string, options: { thread: string; message: string }, command: Command) => {
        const mode = machineMode(rootOptions(command));
        rejectUnsupportedJsonl(mode, 'review message');
        const context = await openContext(rootOptions(command));
        try {
          const view = await context.application.postReviewMessage!({
            runId,
            threadId: options.thread,
            content: options.message,
          });
          if (mode) writeJsonResult('review message', view);
          else printReview(view);
        } finally {
          context.close();
        }
      },
    );

  review
    .command('explain <run-id>')
    .requiredOption('--thread <id>', 'review thread ID')
    .requiredOption('--target-kind <kind>', 'scope, task, change, or finding')
    .requiredOption('--target-id <id>', 'stable target ID')
    .requiredOption('--evidence <text>', 'bounded evidence summary for the explainer')
    .action(
      async (
        runId: string,
        options: { thread: string; targetKind: string; targetId: string; evidence: string },
        command: Command,
      ) => {
        const mode = machineMode(rootOptions(command));
        rejectUnsupportedJsonl(mode, 'review explain');
        const target = reviewTarget(options.targetKind, options.targetId);
        const context = await openContext(rootOptions(command));
        try {
          const explanation = await context.application.explainReview!({
            runId,
            threadId: options.thread,
            target,
            evidence: options.evidence,
          });
          if (mode) writeJsonResult('review explain', explanation);
          else console.log(explanation.explanation.content ?? 'No explanation returned.');
        } finally {
          context.close();
        }
      },
    );

  review
    .command('adjudicate <run-id>')
    .requiredOption('--thread <id>', 'review thread ID')
    .requiredOption('--target-id <id>', 'finding target ID')
    .requiredOption(
      '--decision <decision>',
      'withdrawn, confirmed, reclassified, or needs-human-decision',
    )
    .requiredOption('--issue <text>', 'issue under adjudication')
    .requiredOption('--evidence <items...>', 'additional evidence items')
    .requiredOption('--scope <text>', 'relevant scope')
    .requiredOption('--clarification <text>', 'user clarification')
    .action(
      async (
        runId: string,
        options: {
          thread: string;
          targetId: string;
          decision: string;
          issue: string;
          evidence: string[];
          scope: string;
          clarification: string;
        },
        command: Command,
      ) => {
        const mode = machineMode(rootOptions(command));
        rejectUnsupportedJsonl(mode, 'review adjudicate');
        const context = await openContext(rootOptions(command));
        try {
          const result = await context.application.adjudicateReview!({
            runId,
            threadId: options.thread,
            target: { kind: 'finding', id: options.targetId },
            decision: adjudicationDecision(options.decision),
            issue: options.issue,
            evidence: options.evidence,
            scope: options.scope,
            clarification: options.clarification,
          });
          if (mode) writeJsonResult('review adjudicate', result);
          else printReview(result);
        } finally {
          context.close();
        }
      },
    );

  review
    .command('decide <run-id>')
    .requiredOption('--thread <id>', 'review thread ID')
    .requiredOption('--target-kind <kind>', 'scope, task, change, or finding')
    .requiredOption('--target-id <id>', 'stable target ID')
    .requiredOption(
      '--decision <decision>',
      'approve, reject, correct, withdraw, accept-risk, or postpone',
    )
    .option('--details <text>', 'decision details')
    .action(
      async (
        runId: string,
        options: {
          thread: string;
          targetKind: string;
          targetId: string;
          decision: string;
          details?: string;
        },
        command: Command,
      ) => {
        const target = reviewTarget(options.targetKind, options.targetId);
        await continueAttachedReview(command, runId, 'review decide', async (context, signal) =>
          context.application.decideReview!({
            runId,
            threadId: options.thread,
            target,
            decision: reviewDecision(options.decision),
            ...(options.details ? { details: options.details } : {}),
            signal,
          }),
        );
      },
    );

  review
    .command('finalize <run-id>')
    .requiredOption('--thread <id>', 'review thread ID')
    .requiredOption('--target-kind <kind>', 'scope, change, or finding')
    .requiredOption('--target-id <id>', 'stable target ID')
    .option('--details <text>', 'finalization details')
    .action(
      async (
        runId: string,
        options: { thread: string; targetKind: string; targetId: string; details?: string },
        command: Command,
      ) => {
        const target = reviewTarget(options.targetKind, options.targetId);
        await continueAttachedReview(command, runId, 'review finalize', async (context, signal) =>
          context.application.finalizeReview!({
            runId,
            threadId: options.thread,
            target,
            ...(options.details ? { details: options.details } : {}),
            signal,
          }),
        );
      },
    );
}

async function continueAttachedReview(
  command: Command,
  runId: string,
  commandName: string,
  operation: (
    context: Awaited<ReturnType<typeof openContext>>,
    signal: AbortSignal,
  ) => Promise<import('../../core/run.js').WorkflowRun>,
): Promise<void> {
  const options = rootOptions(command);
  const mode = machineMode(options);
  rejectUnsupportedJsonl(mode, commandName);
  await runAttachedCli(options, runId, commandName, async (context, lifecycle) => {
    const run = await operation(context, lifecycle.signal);
    if (mode) await printMachineRunResult(commandName, run, context, 'json');
    else printRunSummary(await context.application.getRunView(run.id));
  });
}

function reviewTarget(kind: string, id: string): ReviewTarget {
  if (!isReviewTargetKind(kind)) throw new Error(`Invalid review target kind: ${kind}`);
  if (!id.trim()) throw new Error('Review target ID must be non-empty');
  return { kind, id };
}

function isReviewTargetKind(value: string): value is ReviewTargetKind {
  return value === 'scope' || value === 'task' || value === 'change' || value === 'finding';
}

function adjudicationDecision(
  value: string,
): 'withdrawn' | 'confirmed' | 'reclassified' | 'needs-human-decision' {
  if (
    value !== 'withdrawn' &&
    value !== 'confirmed' &&
    value !== 'reclassified' &&
    value !== 'needs-human-decision'
  ) {
    throw new Error(`Invalid adjudication decision: ${value}`);
  }
  return value;
}

function reviewDecision(
  value: string,
): import('../../core/interactive-review.js').ReviewDecisionKind {
  if (
    value !== 'approve' &&
    value !== 'reject' &&
    value !== 'correct' &&
    value !== 'withdraw' &&
    value !== 'accept-risk' &&
    value !== 'postpone'
  ) {
    throw new Error(`Invalid review decision: ${value}`);
  }
  return value;
}

function printReview(view: import('../../application/review-operations.js').ReviewView): void {
  console.log(`Review ${view.runId}  status=${view.status}`);
  for (const entry of view.threads) {
    console.log(
      `  ${entry.thread.id}  phase=${entry.thread.phase}  target=${entry.thread.target.kind}:${entry.thread.target.id}  state=${entry.thread.state}`,
    );
    for (const message of entry.messages) {
      console.log(`    ${message.role}: ${message.content ?? `[${message.contentArtifactId}]`}`);
    }
    for (const decision of entry.decisions) {
      console.log(`    decision=${decision.decision} revision=${decision.revision}`);
    }
  }
}
