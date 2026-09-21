import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { AgentOptions, AgentProfile, ApiClient } from './api.js';

export function ProjectAgents(props: { api: ApiClient; onClose: () => void }): ReactElement {
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [options, setOptions] = useState<AgentOptions>();
  const [sourceHash, setSourceHash] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [draft, setDraft] = useState<AgentProfile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [writeAccessConfirmed, setWriteAccessConfirmed] = useState(false);

  useEffect(() => {
    void props.api
      .getAgentOptions()
      .then(setOptions)
      .catch((cause) => setError(messageOf(cause)));
    void props.api
      .listAgentProfiles()
      .then((result) => {
        setProfiles(result.profiles);
        setSourceHash(result.sourceHash);
        const name = profileNames(result.profiles)[0] ?? 'planner';
        setSelectedName(name);
        setDraft(result.profiles[name] ?? defaultProfile(name));
      })
      .catch((cause) => setError(messageOf(cause)));
  }, [props.api]);

  function select(name: string): void {
    setSelectedName(name);
    setDraft(profiles[name] ?? defaultProfile(name));
    setWriteAccessConfirmed(false);
    setMessage(undefined);
  }

  async function save(): Promise<void> {
    if (!draft || !selectedName || busy) return;
    if (draft.skills?.mode === 'only' && draft.skills.paths.length === 0) {
      setError('Select at least one skill or choose another skills policy.');
      return;
    }
    if (
      selectedName === 'builder' &&
      draft.workspaceMode === 'read-write' &&
      !writeAccessConfirmed
    ) {
      setError('Confirm Builder write access before saving.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await props.api.updateAgentProfile({
        profileName: selectedName,
        profile: draft,
        expectedSourceHash: sourceHash,
        ...(selectedName === 'builder' && draft.workspaceMode === 'read-write'
          ? { writeAccessConfirmed }
          : {}),
      });
      setProfiles(result.profiles);
      setSourceHash(result.sourceHash);
      setDraft(result.profiles[selectedName]);
      setMessage('Agent profile saved.');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  const providers = [...new Set(options?.models.map((model) => model.provider) ?? [])].sort();
  const availableModels =
    options?.models.filter((model) => !draft?.provider || model.provider === draft.provider) ?? [];

  return (
    <section className="agent-settings" aria-labelledby="agent-settings-title">
      <div className="modal-heading">
        <div>
          <p className="eyebrow">Project configuration</p>
          <h2 id="agent-settings-title">Agents</h2>
        </div>
        <button className="button-secondary" type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="agent-settings-layout">
        <nav className="agent-profile-list" aria-label="Agent profiles">
          {profileNames(profiles).map((name) => (
            <button
              className={name === selectedName ? 'is-active' : ''}
              type="button"
              key={name}
              onClick={() => select(name)}
            >
              <strong>{name}</strong>
              <small>{profiles[name]?.workspaceMode ?? 'Not configured'}</small>
            </button>
          ))}
        </nav>
        {draft && (
          <form
            className="agent-profile-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor="agent-provider">Provider</label>
            {providers.length > 0 ? (
              <select
                id="agent-provider"
                value={draft.provider ?? ''}
                onChange={(event) => {
                  const provider = event.target.value;
                  const firstModel = options?.models.find((model) => model.provider === provider);
                  setDraft({
                    ...draft,
                    provider,
                    ...(firstModel ? { model: firstModel.model } : {}),
                  });
                }}
              >
                {!draft.provider && <option value="">Select provider</option>}
                {draft.provider && !providers.includes(draft.provider) && (
                  <option value={draft.provider}>{draft.provider} (unavailable)</option>
                )}
                {providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="agent-provider"
                value={draft.provider ?? ''}
                placeholder="Enter provider"
                onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
              />
            )}
            <label htmlFor="agent-model">Model</label>
            {availableModels.length > 0 ? (
              <select
                id="agent-model"
                value={draft.model}
                onChange={(event) => {
                  const model = availableModels.find((item) => item.model === event.target.value);
                  setDraft({
                    ...draft,
                    model: event.target.value,
                    ...(model && !draft.provider ? { provider: model.provider } : {}),
                  });
                }}
              >
                {!draft.model && <option value="">Select model</option>}
                {draft.model && !availableModels.some((model) => model.model === draft.model) && (
                  <option value={draft.model}>{draft.model} (unavailable)</option>
                )}
                {availableModels.map((model) => (
                  <option key={`${model.provider}/${model.model}`} value={model.model}>
                    {model.displayName ?? model.model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="agent-model"
                value={draft.model}
                placeholder="Enter model"
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
            )}
            <label htmlFor="agent-thinking">Reasoning</label>
            <select
              id="agent-thinking"
              value={draft.thinking ?? 'Default'}
              onChange={(event) => {
                if (event.target.value === 'Default') {
                  const withoutThinking = { ...draft };
                  delete withoutThinking.thinking;
                  setDraft(withoutThinking);
                } else {
                  setDraft({ ...draft, thinking: event.target.value });
                }
              }}
            >
              {(
                options?.thinkingLevels ?? [
                  'Default',
                  'off',
                  'minimal',
                  'low',
                  'medium',
                  'high',
                  'xhigh',
                  'max',
                ]
              ).map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <label htmlFor="agent-instructions">Additional instructions</label>
            <textarea
              id="agent-instructions"
              rows={7}
              maxLength={12000}
              value={draft.instructions ?? ''}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
            <p className="muted">
              The workflow prompt remains protected. These instructions are added after it.
            </p>
            {selectedName === 'builder' && draft.workspaceMode === 'read-write' && (
              <label className="confirmation-field">
                <input
                  type="checkbox"
                  checked={writeAccessConfirmed}
                  onChange={(event) => setWriteAccessConfirmed(event.target.checked)}
                />
                I understand this agent can modify files and run shell commands.
              </label>
            )}
            <label htmlFor="agent-workspace-mode">Workspace access</label>
            <select
              id="agent-workspace-mode"
              value={draft.workspaceMode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  workspaceMode: event.target.value as AgentProfile['workspaceMode'],
                })
              }
            >
              <option value="read-only">Read-only</option>
              <option value="read-write">Read and write</option>
            </select>
            <fieldset className="agent-options-group">
              <legend>Tools</legend>
              {(options?.tools ?? []).map((tool) => (
                <label className="confirmation-field" key={tool.id}>
                  <input
                    type="checkbox"
                    checked={draft.tools.includes(tool.id)}
                    disabled={tool.writeCapable && selectedName !== 'builder'}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tools: event.target.checked
                          ? [...new Set([...draft.tools, tool.id])]
                          : draft.tools.filter((item) => item !== tool.id),
                      })
                    }
                  />
                  <span>
                    <strong>{tool.label}</strong>
                    <small>{tool.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label htmlFor="agent-skills">Skills policy</label>
            <select
              id="agent-skills"
              value={selectedName === 'planner' ? 'none' : (draft.skills?.mode ?? 'discover')}
              disabled={selectedName === 'planner'}
              onChange={(event) => {
                const mode = event.target.value;
                setDraft({
                  ...draft,
                  skills:
                    mode === 'only'
                      ? { mode: 'only', paths: options?.skills[0] ? [options.skills[0].path] : [] }
                      : { mode: mode as 'discover' | 'none' },
                });
              }}
            >
              <option value="discover">Discover automatically</option>
              <option value="none">Disabled</option>
              <option value="only">Use selected skills</option>
            </select>
            {selectedName === 'planner' && (
              <p className="muted">Planner skills are disabled by contract.</p>
            )}
            {draft.skills?.mode === 'only' && (
              <fieldset className="agent-options-group">
                <legend>Selected skills</legend>
                {(options?.skills ?? []).map((skill) => {
                  const selected =
                    draft.skills?.mode === 'only' && draft.skills.paths.includes(skill.path);
                  return (
                    <label className="confirmation-field" key={skill.path}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          if (draft.skills?.mode !== 'only') return;
                          const paths = event.target.checked
                            ? [...new Set([...draft.skills.paths, skill.path])]
                            : draft.skills.paths.filter((path) => path !== skill.path);
                          setDraft({ ...draft, skills: { ...draft.skills, paths } });
                        }}
                      />
                      <span>
                        <strong>{skill.name}</strong>
                        <small>{skill.description}</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            <button type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save agent profile'}
            </button>
          </form>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function profileNames(profiles: Record<string, AgentProfile>): string[] {
  return [...new Set(['planner', 'builder', 'analyst', 'qa', ...Object.keys(profiles)])];
}

function defaultProfile(name: string): AgentProfile {
  const readOnly = name !== 'builder';
  return {
    driver: 'pi',
    model: '',
    tools: readOnly ? ['ls', 'find', 'read'] : ['ls', 'find', 'read'],
    workspaceMode: 'read-only',
    projectTrust: 'never',
    timeoutMs: 180000,
    retryLimit: 0,
    skills: { mode: name === 'planner' ? 'none' : 'discover' },
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The agent profile could not be loaded';
}
