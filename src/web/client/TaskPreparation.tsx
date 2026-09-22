import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ApiRequestError,
  createRequestId,
  type AgentOptions,
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
  const [agentOptions, setAgentOptions] = useState<AgentOptions>();
  const [agentOptionsError, setAgentOptionsError] = useState<string>();
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [activeStage, setActiveStage] = useState<'brief' | 'plan' | 'todo' | 'execution'>('brief');
  const requestId = useRef<string | undefined>(undefined);
  const requestKey = useRef<string | undefined>(undefined);
  const selectedSourcesTask = useRef<string | undefined>(undefined);
  const selectedModelTask = useRef<string | undefined>(undefined);
  const detailGeneration = useRef(0);

  async function refresh(generation = detailGeneration.current): Promise<void> {
    try {
      const next = await props.api.getTaskDetail(props.task.id);
      if (generation !== detailGeneration.current) return;
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
      if (generation === detailGeneration.current) {
        setError(cause instanceof Error ? cause.message : 'The task could not be loaded');
      }
    }
  }

  useEffect(() => {
    const generation = ++detailGeneration.current;
    requestId.current = undefined;
    requestKey.current = undefined;
    selectedSourcesTask.current = undefined;
    if (selectedModelTask.current !== props.task.id) {
      selectedModelTask.current = props.task.id;
      setSelectedModelKey('');
    }
    setDetail(undefined);
    setMessage('');
    setQuery('');
    setUrl('');
    setComment('');
    setPendingMessage(undefined);
    setStatus(undefined);
    void refresh(generation);
  }, [props.api, props.task.id, props.task.revision]);

  useEffect(() => {
    let active = true;
    void props.api
      .getAgentOptions()
      .then((options) => {
        if (active) {
          setAgentOptions(options);
          setAgentOptionsError(undefined);
        }
      })
      .catch((cause) => {
        if (active)
          setAgentOptionsError(
            cause instanceof Error ? cause.message : 'Model options could not be loaded',
          );
      });
    return () => {
      active = false;
    };
  }, [props.api]);

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

  const approvedPlanVersion = detail?.approvedPlan?.version;
  const briefReady =
    detail !== undefined &&
    detail.lastSequence > 0 &&
    detail.briefConfirmedThroughSequence >= detail.lastSequence;
  const sourceById = new Map(detail?.sources.map((source) => [source.id, source]) ?? []);
  const selectedModel = agentOptions?.models.find((model) => modelKey(model) === selectedModelKey);
  const selectedModelStillAvailable = selectedModelKey === '' || selectedModel !== undefined;

  useEffect(() => {
    if (!selectedModelStillAvailable) setSelectedModelKey('');
  }, [selectedModelStillAvailable]);

  const detailLoaded = detail !== undefined;

  useEffect(() => {
    if (!detailLoaded) return;
    if (!briefReady) setActiveStage('brief');
    else if (props.task.phase !== 'todo') setActiveStage('plan');
    else if (props.task.readiness === 'ready') setActiveStage('execution');
    else setActiveStage('todo');
  }, [briefReady, detailLoaded, props.task.phase, props.task.readiness]);

  return (
    <section className="task-panel task-workspace" aria-labelledby="task-preparation-title">
      <p className="eyebrow">
        {props.task.phase} · revision {props.task.revision}
      </p>
      <h2 id="task-preparation-title">Task {props.task.id}</h2>
      <p>
        Readiness: <strong>{props.task.readiness}</strong>
      </p>
      {detail ? (
        <>
          <nav className="task-stage-nav" aria-label="Task phases">
            {(
              [
                ['brief', 'Brief', 'Prepare'],
                ['plan', 'Plan', 'Propose'],
                ['todo', 'TODO', 'Organize'],
                ['execution', 'Execution', 'Operate'],
              ] as const
            ).map(([stage, title, hint], index) => (
              <button
                className={activeStage === stage ? 'is-active' : ''}
                type="button"
                key={stage}
                onClick={() => setActiveStage(stage)}
                aria-current={activeStage === stage ? 'step' : undefined}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{title}</strong>
                <small>{hint}</small>
              </button>
            ))}
          </nav>
          <p className="stage-orientation">
            {activeStage === 'brief' && 'Complete the context before generating a plan.'}
            {activeStage === 'plan' && 'Review the approach before building.'}
            {activeStage === 'todo' && 'Check the work before execution.'}
            {activeStage === 'execution' && 'Confirm the conditions before starting.'}
          </p>
          <div className={`task-stage task-stage-${activeStage}`}>
            <p>Preparation revision {detail.preparationRevision}.</p>
            {detail.messagesCompactedThroughSequence > 0 && (
              <p className="context-notice">
                Earlier messages remain in the history, but the assistant now uses the confirmed
                brief and messages after sequence {detail.messagesCompactedThroughSequence}.
              </p>
            )}
            {detail.sessionRecoveredAt && (
              <p className="context-notice">
                The previous preparation operation was recovered and will start a new assistant
                session.
              </p>
            )}
            <section
              className="conversation-panel task-stage-pane task-stage-pane-brief"
              aria-labelledby="task-messages-title"
            >
              <div className="section-heading">
                <div>
                  <h3 id="task-messages-title">Conversation</h3>
                  <p className="muted">
                    Describe the outcome. The assistant will keep the brief updated.
                  </p>
                </div>
                {agentOptionsError && <p className="context-notice">{agentOptionsError}</p>}
                {agentOptions && agentOptions.models.length > 0 && (
                  <label className="model-selector" htmlFor="brief-model">
                    <span>Brief model</span>
                    <select
                      id="brief-model"
                      value={selectedModelKey}
                      onChange={(event) => setSelectedModelKey(event.target.value)}
                      disabled={busy}
                    >
                      <option value="">
                        Project planner default — {formatModel(agentOptions.plannerDefault)}
                      </option>
                      {agentOptions.models.map((model) => (
                        <option key={modelKey(model)} value={modelKey(model)}>
                          {model.displayName ?? model.model} — {formatModel(model)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
                    {item.role === 'assistant' && (
                      <small className="chat-model-label">
                        {item.metadata?.executionModel
                          ? `Confirmed: ${formatModel(item.metadata.executionModel)}`
                          : 'Model confirmation unavailable'}
                      </small>
                    )}
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
                  void submit('reply', {
                    message,
                    sourceIds: selectedSources,
                    ...(selectedModel
                      ? {
                          modelSelection: {
                            provider: selectedModel.provider,
                            model: selectedModel.model,
                          },
                        }
                      : {}),
                  });
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
            <section
              className="task-stage-pane task-stage-pane-brief"
              aria-labelledby="task-sources-title"
            >
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
            <section
              className="task-stage-pane task-stage-pane-plan"
              aria-labelledby="task-plan-title"
            >
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
                {briefReady ? 'Brief confirmed' : 'Confirm brief'}
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
                  <h4>Plan version {detail.plan?.version} is available.</h4>
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
                    onClick={() =>
                      void submit('approve-plan', { planVersion: detail.plan!.version })
                    }
                    disabled={busy}
                  >
                    Approve plan
                  </button>
                </>
              )}
            </section>
            <section
              className="task-stage-pane task-stage-pane-todo"
              aria-labelledby="task-todo-title"
            >
              <h3 id="task-todo-title">Review TODO</h3>
              <p className="muted">Inspect the approved work before starting execution.</p>
              {detail.todoDocument ? (
                <TodoView todo={detail.todoDocument} />
              ) : approvedPlanVersion ? (
                <button
                  type="button"
                  onClick={() => void submit('generate-todo', { planVersion: approvedPlanVersion })}
                  disabled={busy}
                >
                  Generate TODO
                </button>
              ) : (
                <p>The approved plan is required before generating a TODO.</p>
              )}
            </section>
            <div className="task-stage-pane task-stage-pane-execution">
              <TaskExecution api={props.api} task={props.task} />
            </div>
          </div>
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

function TodoView({ todo }: { todo: NonNullable<TaskDetail['todoDocument']> }): ReactElement {
  return (
    <div className="todo-view">
      {todo.phases.map((phase) => (
        <section key={phase.id}>
          <h4>{phase.title}</h4>
          {phase.tasks.map((task) => (
            <article key={task.id}>
              <h5>{task.id}</h5>
              <ul>
                {task.instructions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p>
                <strong>Files:</strong> {task.files.join(', ') || 'None specified'}
              </p>
              <BriefList title="Acceptance criteria" items={task.acceptanceCriteria} />
              <BriefList title="Verification" items={task.verification} />
              <BriefList title="Stop conditions" items={task.stopConditions} />
            </article>
          ))}
        </section>
      ))}
      <BriefList title="Scope changes" items={todo.scopeChanges} />
    </div>
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

function formatModel(model: { provider?: string; model: string }): string {
  return `${model.provider ? `${model.provider}/` : ''}${model.model}`;
}

function modelKey(model: { provider: string; model: string }): string {
  return JSON.stringify([model.provider, model.model]);
}

function isSource(source: Source | undefined): source is Source {
  return source !== undefined;
}
