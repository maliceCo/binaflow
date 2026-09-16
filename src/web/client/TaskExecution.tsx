import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, ExecutionPreview, ExecutionProgress, Task } from './api.js';
import { createRequestId } from './api.js';

export function TaskExecution(props: { api: ApiClient; task: Task }): ReactElement {
  const [preview, setPreview] = useState<ExecutionPreview>();
  const [progress, setProgress] = useState<ExecutionProgress>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef<string | undefined>(undefined);
  const todoVersion = props.task.todo?.version;

  useEffect(() => {
    let active = true;
    void props.api
      .getTaskExecution(props.task.id)
      .then((next) => {
        if (active && next) setProgress(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [props.api, props.task.id, props.task.executionRunId]);

  useEffect(() => {
    if (!progress || progress.nextAction === 'review-changes' || progress.nextAction === 'none') {
      return;
    }
    const timer = window.setInterval(() => {
      void props.api
        .getTaskExecution(props.task.id)
        .then((next) => {
          if (next) setProgress(next);
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [props.api, props.task.id, progress?.nextAction]);

  async function loadPreview(): Promise<void> {
    if (busy || !todoVersion) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(
        await props.api.previewTaskExecution(props.task.id, props.task.revision, todoVersion),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The execution preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function start(): Promise<void> {
    if (busy || !preview || !todoVersion) return;
    const id = requestId.current ?? createRequestId();
    requestId.current = id;
    setBusy(true);
    setError(undefined);
    try {
      setProgress(
        await props.api.startTaskExecution({
          requestId: id,
          contractId: props.task.id,
          expectedRevision: props.task.revision,
          todoVersion,
          previewDigest: preview.digest,
        }),
      );
      requestId.current = undefined;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The execution could not be started');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!progress || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setProgress(await props.api.cancelTaskExecution(progress.runId, 'Cancelled from the web'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The execution could not be cancelled');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="task-execution" aria-labelledby="task-execution-title">
      <h3 id="task-execution-title">Execution</h3>
      {!todoVersion && <p>Generate and approve a TODO before execution.</p>}
      {!progress && todoVersion && (
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
          {progress.nextAction === 'cancel' && (
            <button type="button" onClick={() => void cancel()} disabled={busy}>
              Cancel execution
            </button>
          )}
          {progress.nextAction === 'review-changes' && (
            <p>Execution is waiting for changes review.</p>
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
