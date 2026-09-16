import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, Task, TaskDetail } from './api.js';
import { createRequestId } from './api.js';

export function TaskPreparation(props: {
  api: ApiClient;
  task: Task;
  onRefresh: () => Promise<void>;
}): ReactElement {
  const [detail, setDetail] = useState<TaskDetail>();
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [comment, setComment] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const requestId = useRef<string | undefined>(undefined);

  async function refresh(): Promise<void> {
    try {
      const next = await props.api.getTaskDetail(props.task.id);
      setDetail(next);
      setSelectedSources((current) =>
        current.filter((sourceId) => next.sources.some((source) => source.id === sourceId)),
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The task could not be loaded');
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.api, props.task.id, props.task.revision]);

  async function submit(kind: string, fields: Record<string, unknown> = {}): Promise<void> {
    if (!detail || busy) return;
    const operationRequestId = requestId.current ?? createRequestId();
    requestId.current = operationRequestId;
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.api.execute(props.task.id, {
        schemaVersion: 1,
        requestId: operationRequestId,
        contractId: props.task.id,
        expectedRevision: detail.revision,
        expectedPreparationRevision: detail.preparationRevision,
        kind,
        ...fields,
      });
      requestId.current = undefined;
      setStatus(`${result.kind}: ${result.status}`);
      await refresh();
      await props.onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The preparation operation failed');
      setStatus('Request may still be running; retry keeps the same request ID.');
    } finally {
      setBusy(false);
    }
  }

  const briefConfirmed = detail?.preparationRevision !== undefined && detail.lastSequence >= 0;
  const planVersion = detail?.approvedPlan?.version ?? detail?.plan?.version;

  return (
    <section className="task-panel" aria-labelledby="task-preparation-title">
      <p className="eyebrow">
        {props.task.phase} · revision {props.task.revision}
      </p>
      <h2 id="task-preparation-title">Task {props.task.id}</h2>
      <p>
        Readiness: <strong>{props.task.readiness}</strong>
      </p>
      {detail ? (
        <>
          <p>Preparation revision {detail.preparationRevision}.</p>
          <section aria-labelledby="task-messages-title">
            <h3 id="task-messages-title">Conversation</h3>
            {detail.messages.length === 0 ? (
              <p>No messages yet.</p>
            ) : (
              <ul>
                {detail.messages.map((item) => (
                  <li key={item.id}>
                    <strong>{item.role}:</strong> {item.content}
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit('reply', { message, sourceIds: selectedSources });
              }}
            >
              <label htmlFor="task-message">Message</label>
              <textarea
                id="task-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !message.trim()}>
                Send message
              </button>
            </form>
          </section>
          <section aria-labelledby="task-sources-title">
            <h3 id="task-sources-title">Sources</h3>
            {detail.sources.length === 0 ? (
              <p>No sources selected.</p>
            ) : (
              <ul>
                {detail.sources.map((source) => (
                  <li key={source.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(source.id)}
                        onChange={() =>
                          setSelectedSources((current) =>
                            current.includes(source.id)
                              ? current.filter((id) => id !== source.id)
                              : [...current, source.id],
                          )
                        }
                      />
                      {source.title} ({source.url})
                    </label>
                    <p>{source.excerpt}</p>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit('search', { query });
              }}
            >
              <label htmlFor="source-query">Search query</label>
              <input
                id="source-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !query.trim()}>
                Search sources
              </button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit('fetch-source', { url });
              }}
            >
              <label htmlFor="source-url">Source URL</label>
              <input
                id="source-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !url.trim()}>
                Read source
              </button>
            </form>
          </section>
          <section aria-labelledby="task-plan-title">
            <h3 id="task-plan-title">Brief and plan</h3>
            <p>{detail.currentBrief.objective}</p>
            <button
              type="button"
              onClick={() =>
                void submit('confirm-brief', {
                  brief: detail.currentBrief,
                  throughSequence: detail.lastSequence,
                  sourceIds: selectedSources,
                })
              }
              disabled={busy || !briefConfirmed}
            >
              Confirm brief
            </button>
            <button
              type="button"
              onClick={() => void submit('generate-plan', { sourceIds: selectedSources })}
              disabled={busy}
            >
              Generate plan
            </button>
            {detail.plan && <p>Plan version {detail.plan.version} is available.</p>}
            {detail.plan && (
              <>
                <label htmlFor="plan-comment">Plan comment</label>
                <textarea
                  id="plan-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() =>
                    void submit('comment-plan', {
                      planVersion: detail.plan!.version,
                      content: comment,
                    })
                  }
                  disabled={busy || !comment.trim()}
                >
                  Comment and regenerate
                </button>
                <button
                  type="button"
                  onClick={() => void submit('approve-plan', { planVersion: detail.plan!.version })}
                  disabled={busy}
                >
                  Approve plan
                </button>
              </>
            )}
            {planVersion && (
              <button
                type="button"
                onClick={() => void submit('generate-todo', { planVersion })}
                disabled={busy}
              >
                Generate TODO
              </button>
            )}
          </section>
        </>
      ) : (
        <p>Loading preparation...</p>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
