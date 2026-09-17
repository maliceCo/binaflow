import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ApiRequestError,
  createRequestId,
  type ApiClient,
  type Source,
  type Task,
  type TaskDetail,
} from './api.js';
import { TaskExecution } from './TaskExecution.js';

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
  const [pendingMessage, setPendingMessage] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const requestId = useRef<string | undefined>(undefined);
  const requestKey = useRef<string | undefined>(undefined);
  const selectedSourcesTask = useRef<string | undefined>(undefined);

  async function refresh(): Promise<void> {
    try {
      const next = await props.api.getTaskDetail(props.task.id);
      setDetail(next);
      if (selectedSourcesTask.current !== props.task.id) {
        selectedSourcesTask.current = props.task.id;
        setSelectedSources(next.confirmedSourceIds);
      } else {
        setSelectedSources((current) =>
          current.filter((sourceId) => next.sources.some((source) => source.id === sourceId)),
        );
      }
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The task could not be loaded');
    }
  }

  useEffect(() => {
    requestId.current = undefined;
    requestKey.current = undefined;
    selectedSourcesTask.current = undefined;
    void refresh();
  }, [props.api, props.task.id, props.task.revision]);

  useEffect(() => {
    if (!detail?.activeOperation) return;
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [detail?.activeOperation?.requestId]);

  async function submit(kind: string, fields: Record<string, unknown> = {}): Promise<void> {
    if (!detail || busy) return;
    const operationKey = JSON.stringify({
      contractId: props.task.id,
      expectedRevision: detail.revision,
      expectedPreparationRevision: detail.preparationRevision,
      kind,
      ...fields,
    });
    if (requestKey.current !== operationKey) {
      requestId.current = undefined;
      requestKey.current = operationKey;
    }
    const operationRequestId = requestId.current ?? createRequestId();
    requestId.current = operationRequestId;
    const before = detail;
    if (kind === 'reply') setPendingMessage(String(fields.message ?? ''));
    setBusy(true);
    setError(undefined);
    let accepted = false;
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
      accepted = true;
      setStatus(`${result.kind}: ${result.status}`);
      await waitForPreparationUpdate(kind, before);
      requestId.current = undefined;
      requestKey.current = undefined;
      setPendingMessage(undefined);
      await refresh();
      await props.onRefresh();
    } catch (cause) {
      const plannerOutputInvalid =
        cause instanceof ApiRequestError && cause.code === 'planner-output-invalid';
      const retryable =
        !plannerOutputInvalid &&
        (accepted || (cause instanceof ApiRequestError && cause.status === 422));
      if (cause instanceof ApiRequestError && !retryable) {
        requestId.current = undefined;
        requestKey.current = undefined;
      }
      await refresh();
      setPendingMessage(undefined);
      setError(cause instanceof Error ? cause.message : 'The preparation operation failed');
      setStatus(
        plannerOutputInvalid
          ? 'The planner result was invalid; retry to generate a new result.'
          : retryable
            ? 'Request may still be running; retry keeps the same request ID.'
            : 'The request was rejected; submit it again to create a new request ID.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function waitForPreparationUpdate(kind: string, before: TaskDetail): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const next = await props.api.getTaskDetail(props.task.id);
      if (
        (kind === 'reply' && next.messages.length > before.messages.length) ||
        (kind === 'search' && next.sources.length > before.sources.length) ||
        (kind === 'fetch-source' && next.sources.length > before.sources.length) ||
        (kind === 'confirm-brief' && next.preparationRevision > before.preparationRevision) ||
        (kind === 'generate-plan' && next.plan !== null) ||
        (kind === 'comment-plan' && next.revision > before.revision) ||
        (kind === 'approve-plan' && next.approvedPlan !== null) ||
        (kind === 'generate-todo' && next.todo !== null)
      ) {
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
    }
    throw new Error('The operation is still running; retry will reuse its request ID');
  }

  async function recoverActiveOperation(): Promise<void> {
    const operation = detail?.activeOperation;
    if (!operation || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.api.recover(props.task.id, operation.requestId);
      setStatus(`${result.kind}: ${result.status}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The operation could not be recovered');
    } finally {
      setBusy(false);
    }
  }

  const planVersion = detail?.approvedPlan?.version ?? detail?.plan?.version;
  const briefReady = detail ? detail.briefConfirmedThroughSequence >= detail.lastSequence : false;
  const sourceById = new Map(detail?.sources.map((source) => [source.id, source]) ?? []);

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
          {detail.messagesCompactedThroughSequence > 0 && (
            <p className="context-notice">
              Earlier messages remain in the history, but the assistant now uses the confirmed brief
              and messages after sequence {detail.messagesCompactedThroughSequence}.
            </p>
          )}
          {detail.sessionRecoveredAt && (
            <p className="context-notice">
              The previous preparation operation was recovered and will start a new assistant
              session.
            </p>
          )}
          <section className="conversation-panel" aria-labelledby="task-messages-title">
            <div className="section-heading">
              <div>
                <h3 id="task-messages-title">Conversation</h3>
                <p className="muted">
                  Describe the outcome. The assistant will keep the brief updated.
                </p>
              </div>
              {detail.activeOperation && (
                <div className="operation-status">
                  <span className="operation-pill">Working: {detail.activeOperation.kind}</span>
                  <button
                    type="button"
                    onClick={() => void recoverActiveOperation()}
                    disabled={busy}
                  >
                    Recover operation
                  </button>
                </div>
              )}
            </div>
            <div className="chat-thread" aria-live="polite">
              {detail.messages.length === 0 && !pendingMessage && (
                <p className="empty-chat">No messages yet. Start with the result you need.</p>
              )}
              {detail.messages.map((item) => (
                <article className={`chat-turn chat-turn-${item.role}`} key={item.id}>
                  <div className="chat-turn-label">
                    {item.role === 'user' ? 'You' : 'Assistant'}
                  </div>
                  <p>{item.content}</p>
                  {item.metadata?.questions.length ? (
                    <div className="chat-questions">
                      <strong>Questions to resolve</strong>
                      <ul>
                        {item.metadata.questions.map((question) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {item.metadata?.citedSourceIds.length ? (
                    <SourceAttachments
                      sources={item.metadata.citedSourceIds
                        .map((id) => sourceById.get(id))
                        .filter(isSource)}
                    />
                  ) : null}
                </article>
              ))}
              {pendingMessage && (
                <>
                  <article className="chat-turn chat-turn-user chat-turn-pending">
                    <div className="chat-turn-label">You</div>
                    <p>{pendingMessage}</p>
                  </article>
                  <article
                    className="chat-turn chat-turn-assistant chat-turn-pending"
                    aria-label="Assistant is thinking"
                  >
                    <div className="chat-turn-label">Assistant</div>
                    <p className="thinking-indicator">Reviewing the brief and evidence...</p>
                  </article>
                </>
              )}
            </div>
            {selectedSources.length > 0 && (
              <SourceAttachments
                label="Attachments for this message"
                sources={selectedSources.map((id) => sourceById.get(id)).filter(isSource)}
              />
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
                placeholder="What should this task achieve?"
              />
              <button type="submit" disabled={busy || !message.trim()}>
                Send message
              </button>
            </form>
          </section>
          <section aria-labelledby="task-sources-title">
            <div className="section-heading">
              <div>
                <h3 id="task-sources-title">Evidence attachments</h3>
                <p className="muted">Select sources to attach to the next assistant request.</p>
              </div>
              <span className="muted">{selectedSources.length}/5 selected</span>
            </div>
            {detail.sources.length === 0 ? (
              <p>No sources yet.</p>
            ) : (
              <ul className="source-list">
                {detail.sources.map((source) => (
                  <li
                    key={source.id}
                    className={selectedSources.includes(source.id) ? 'source-selected' : ''}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(source.id)}
                        disabled={
                          busy ||
                          (!selectedSources.includes(source.id) && selectedSources.length >= 5)
                        }
                        onChange={() =>
                          setSelectedSources((current) =>
                            current.includes(source.id)
                              ? current.filter((id) => id !== source.id)
                              : [...current, source.id],
                          )
                        }
                      />
                      <span>{source.title}</span>
                    </label>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.url}
                    </a>
                    <p>{source.excerpt}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="source-tools">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit('search', { query });
                }}
              >
                <label htmlFor="source-query">Search the web</label>
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
                <label htmlFor="source-url">Attach URL</label>
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
            </div>
          </section>
          <section aria-labelledby="task-plan-title">
            <h3 id="task-plan-title">Review and confirm brief</h3>
            <p className="muted">This is a draft until you explicitly confirm it.</p>
            <BriefView brief={detail.draftBrief} />
            <button
              type="button"
              onClick={() =>
                void submit('confirm-brief', {
                  brief: detail.draftBrief,
                  throughSequence: detail.lastSequence,
                  sourceIds: selectedSources,
                })
              }
              disabled={busy || briefReady}
            >
              {briefReady ? 'Brief confirmed' : 'Confirm reviewed brief'}
            </button>
            <button
              type="button"
              onClick={() => void submit('generate-plan', { sourceIds: selectedSources })}
              disabled={busy || !briefReady}
            >
              Generate plan
            </button>
            {detail.planDocument && (
              <div className="plan-review">
                <h4>Plan version {detail.plan?.version}</h4>
                <p>{detail.planDocument.summary}</p>
                <ol>
                  {detail.planDocument.items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                      <ul>
                        {item.acceptanceCriteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
                <h4>Verification</h4>
                <ul>
                  {detail.planDocument.verification.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
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
          <TaskExecution api={props.api} task={props.task} />
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

function BriefView({ brief }: { brief: TaskDetail['draftBrief'] }): ReactElement {
  return (
    <div className="brief-view">
      <h4>{brief.objective}</h4>
      <BriefList title="Conclusions" items={brief.conclusions} />
      <BriefList title="Constraints" items={brief.constraints} />
      <BriefList title="Out of scope" items={brief.outOfScope} />
    </div>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function SourceAttachments({
  label = 'Sources',
  sources,
}: {
  label?: string;
  sources: Source[];
}): ReactElement | null {
  if (sources.length === 0) return null;
  return (
    <div className="source-attachments">
      <strong>{label}</strong>
      <div>
        {sources.map((source) => (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
        ))}
      </div>
    </div>
  );
}

function isSource(source: Source | undefined): source is Source {
  return source !== undefined;
}
