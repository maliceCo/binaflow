import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ChangeSet } from '../api-contract.js';
import type {
  ApiClient,
  ExecutionPreview,
  ExecutionProgress,
  ExecutionResumePreview,
  Task,
} from './api.js';
import { createRequestId } from './api.js';

export function TaskExecution(props: { api: ApiClient; task: Task }): ReactElement {
  const [preview, setPreview] = useState<ExecutionPreview>();
  const [progress, setProgress] = useState<ExecutionProgress>();
  const [resumePreview, setResumePreview] = useState<ExecutionResumePreview>();
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef<string | undefined>(undefined);
  const taskGeneration = useRef(0);
  const todoVersion = props.task.todo?.version;
  const executionReady = todoVersion !== undefined && props.task.readiness === 'ready';

  useEffect(() => {
    const generation = ++taskGeneration.current;
    requestId.current = undefined;
    setPreview(undefined);
    setProgress(undefined);
    setResumePreview(undefined);
    setBusy(false);
    setLoading(true);
    setError(undefined);
    let active = true;
    void props.api
      .getTaskExecution(props.task.id)
      .then((next) => {
        if (active && generation === taskGeneration.current) setProgress(next ?? undefined);
      })
      .catch((cause) => {
        if (active && generation === taskGeneration.current) {
          setError(cause instanceof Error ? cause.message : 'The execution could not be loaded');
        }
      })
      .finally(() => {
        if (active && generation === taskGeneration.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.api, props.task.id, props.task.executionRunId, reloadToken]);

  useEffect(() => {
    if (
      !progress ||
      (progress.nextAction !== 'resume' && progress.nextAction !== 'review-changes')
    ) {
      setResumePreview(undefined);
      return;
    }
    let active = true;
    void props.api
      .previewTaskExecutionResume(progress.runId)
      .then((next) => {
        if (active) setResumePreview(next);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'The resume preview failed');
      });
    return () => {
      active = false;
    };
  }, [props.api, progress?.runId, progress?.revision, progress?.nextAction]);

  useEffect(() => {
    if (!progress || progress.nextAction === 'review-changes' || progress.nextAction === 'none') {
      return;
    }
    const generation = taskGeneration.current;
    const timer = window.setInterval(() => {
      void props.api
        .getTaskExecution(props.task.id)
        .then((next) => {
          if (generation === taskGeneration.current && next) setProgress(next);
        })
        .catch((cause) => {
          if (generation === taskGeneration.current) {
            setError(
              cause instanceof Error ? cause.message : 'The execution could not be refreshed',
            );
          }
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [props.api, props.task.id, progress?.nextAction]);

  async function loadPreview(): Promise<void> {
    if (busy || !executionReady || !todoVersion) return;
    const generation = taskGeneration.current;
    setBusy(true);
    setError(undefined);
    try {
      const next = await props.api.previewTaskExecution(
        props.task.id,
        props.task.revision,
        todoVersion,
      );
      if (generation === taskGeneration.current) setPreview(next);
    } catch (cause) {
      if (generation === taskGeneration.current)
        setError(cause instanceof Error ? cause.message : 'The execution preview failed');
    } finally {
      if (generation === taskGeneration.current) setBusy(false);
    }
  }

  async function start(): Promise<void> {
    if (busy || !preview || !executionReady || !todoVersion) return;
    const generation = taskGeneration.current;
    const id = requestId.current ?? createRequestId();
    requestId.current = id;
    setBusy(true);
    setError(undefined);
    try {
      const next = await props.api.startTaskExecution({
        requestId: id,
        contractId: props.task.id,
        expectedRevision: props.task.revision,
        todoVersion,
        previewDigest: preview.digest,
      });
      if (generation === taskGeneration.current) {
        setProgress(next);
        requestId.current = undefined;
      }
    } catch (cause) {
      if (generation === taskGeneration.current)
        setError(cause instanceof Error ? cause.message : 'The execution could not be started');
    } finally {
      if (generation === taskGeneration.current) setBusy(false);
    }
  }

  async function resume(decision: 'retry-task' | 'continue' | 'approve-changes'): Promise<void> {
    if (busy || !progress || !resumePreview) return;
    if (!resumePreview.allowedDecisions.includes(decision)) return;
    const generation = taskGeneration.current;
    setBusy(true);
    setError(undefined);
    try {
      const next = await props.api.resumeTaskExecution({
        runId: progress.runId,
        expectedRevision: resumePreview.revision,
        previewDigest: resumePreview.digest,
        decision,
        reason:
          decision === 'retry-task'
            ? 'Retry requested from the web'
            : 'Changes reviewed from the web',
      });
      if (generation === taskGeneration.current) {
        setProgress(next);
        setResumePreview(undefined);
      }
    } catch (cause) {
      if (generation === taskGeneration.current)
        setError(cause instanceof Error ? cause.message : 'The execution could not be resumed');
    } finally {
      if (generation === taskGeneration.current) setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!progress || busy) return;
    const generation = taskGeneration.current;
    setBusy(true);
    setError(undefined);
    try {
      const next = await props.api.cancelTaskExecution(progress.runId, 'Cancelled from the web');
      if (generation === taskGeneration.current) setProgress(next);
    } catch (cause) {
      if (generation === taskGeneration.current)
        setError(cause instanceof Error ? cause.message : 'The execution could not be cancelled');
    } finally {
      if (generation === taskGeneration.current) setBusy(false);
    }
  }

  return (
    <section className="task-execution" aria-labelledby="task-execution-title">
      <h3 id="task-execution-title">Execution</h3>
      {loading && <p role="status">Loading execution status...</p>}
      {!loading && error && !progress && (
        <button type="button" onClick={() => setReloadToken((value) => value + 1)} disabled={busy}>
          Retry loading execution
        </button>
      )}
      {!loading && !todoVersion && <p>Generate and approve a TODO before execution.</p>}
      {!loading && todoVersion && !executionReady && (
        <p>Execution is unavailable until the task is ready for execution.</p>
      )}
      {!loading && !error && !progress && executionReady && (
        <button type="button" onClick={() => void loadPreview()} disabled={busy}>
          {busy ? 'Preparing preview...' : 'Preview execution'}
        </button>
      )}
      {preview && !progress && (
        <div role="status">
          <p>Preview digest: {preview.digest}</p>
          <p>Workspace clean: {preview.gitClean ? 'yes' : 'no'}.</p>
          <p>Changes detected: {preview.blockerCount}.</p>
          <button type="button" onClick={() => void start()} disabled={busy}>
            Confirm and start execution
          </button>
        </div>
      )}
      {progress && (
        <div>
          <p>
            Run {progress.runId}: {progress.status} · {progress.stage}
          </p>
          <ul>
            {progress.phases.map((phase) => (
              <li key={phase.id}>
                {phase.title}: {phase.status}
                <ul>
                  {phase.tasks.map((task) => (
                    <li key={task.id}>
                      {task.id}: {task.status} (attempt {task.attempt})
                      <Artifacts task={task} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {progress.activeBlock && (
            <div role="alert">
              <p>
                {progress.activeBlock.type}: {progress.activeBlock.reason}
              </p>
              <ArtifactList artifacts={progress.activeBlock.evidence} />
            </div>
          )}
          {progress.nextAction === 'resume' &&
            resumePreview?.allowedDecisions.includes('retry-task') && (
              <button type="button" onClick={() => void resume('retry-task')} disabled={busy}>
                Retry task
              </button>
            )}
          {progress.nextAction === 'review-changes' && (
            <>
              <p>Execution is waiting for changes review.</p>
              {progress.changeSet ? (
                <ChangeSetReview changeSet={progress.changeSet} />
              ) : (
                <p>No file changes were produced.</p>
              )}
              {resumePreview?.allowedDecisions.includes('approve-changes') && (
                <button
                  type="button"
                  onClick={() => void resume('approve-changes')}
                  disabled={busy}
                >
                  Approve changes and finish
                </button>
              )}
            </>
          )}
          {((progress.nextAction === 'cancel' && !resumePreview) ||
            resumePreview?.allowedDecisions.includes('cancel')) && (
            <button type="button" onClick={() => void cancel()} disabled={busy}>
              Cancel execution
            </button>
          )}
          {progress.nextAction === 'none' && <p>Execution finished.</p>}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ChangeSetReview(props: { changeSet: ChangeSet }): ReactElement {
  return (
    <section aria-label="Changes review">
      <p>
        Change set {props.changeSet.id}, revision {props.changeSet.revision} (
        {props.changeSet.status})
      </p>
      <ul>
        {props.changeSet.files.map((file) => (
          <li key={`${file.oldPath ?? ''}:${file.path}`}>
            <strong>{file.path}</strong> ({file.status}){file.binary ? <span> binary</span> : null}
            {file.hunks.map((hunk) => (
              <pre key={`${file.path}:${hunk.oldStart}:${hunk.newStart}`}>
                {hunk.lines
                  .map(
                    (line) =>
                      `${line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' '}${line.text}`,
                  )
                  .join('\n')}
              </pre>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Artifacts(props: {
  task: {
    resultArtifact?: { id: string; name: string; sizeBytes: number };
    verificationArtifact?: { id: string; name: string; sizeBytes: number };
  };
}): ReactElement {
  return (
    <ArtifactList
      artifacts={[props.task.resultArtifact, props.task.verificationArtifact].filter(
        (artifact): artifact is { id: string; name: string; sizeBytes: number } =>
          artifact !== undefined,
      )}
    />
  );
}

function ArtifactList(props: {
  artifacts: Array<{ id: string; name: string; sizeBytes: number }>;
}): ReactElement | null {
  if (props.artifacts.length === 0) return null;
  return (
    <ul>
      {props.artifacts.map((artifact) => (
        <li key={artifact.id}>
          Artifact {artifact.name} ({artifact.sizeBytes} bytes)
        </li>
      ))}
    </ul>
  );
}
