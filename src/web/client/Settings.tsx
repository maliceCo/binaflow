import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, LauncherSettings, SetupRootCandidate } from './api.js';

export function Settings(props: {
  api: ApiClient;
  settings: LauncherSettings;
  onSaved: (settings: LauncherSettings) => void;
  setup?: boolean;
  mode?: 'server' | 'locations';
}): ReactElement {
  const mode = props.mode ?? (props.setup ? 'server' : 'server');
  const [deviceName, setDeviceName] = useState(props.settings.deviceName);
  const [host, setHost] = useState(props.settings.web.host);
  const [port, setPort] = useState(String(props.settings.web.port));
  const [origin, setOrigin] = useState(props.settings.web.origin);
  const [certificatePem, setCertificatePem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [rootCandidates, setRootCandidates] = useState<SetupRootCandidate[]>([]);
  const [rootBusy, setRootBusy] = useState<string>();

  useEffect(() => {
    if (!props.api.listSetupRoots) return;
    void props.api
      .listSetupRoots()
      .then(setRootCandidates)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Project roots could not be loaded'),
      );
  }, [props.api]);

  async function authorizeRoot(candidateId: string): Promise<void> {
    if (!props.api.authorizeSetupRoot || rootBusy) return;
    setRootBusy(candidateId);
    setError(undefined);
    try {
      const result = await props.api.authorizeSetupRoot(candidateId);
      props.onSaved(result.settings);
      setRootCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
      setMessage(
        result.restartRequired
          ? 'Root authorized. Restart Binaflow to apply network changes.'
          : 'Project root authorized.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project root could not be authorized');
    } finally {
      setRootBusy(undefined);
    }
  }

  async function revokeRoot(rootId: string): Promise<void> {
    if (!props.api.revokeProjectRoot || rootBusy) return;
    setRootBusy(rootId);
    setError(undefined);
    try {
      const result = await props.api.revokeProjectRoot(rootId);
      props.onSaved(result.settings);
      if (props.api.listSetupRoots) setRootCandidates(await props.api.listSetupRoots());
      setMessage('Folder authorization removed. Registered projects and files were kept.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project root could not be removed');
    } finally {
      setRootBusy(undefined);
    }
  }

  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      if (props.setup && props.settings.projectRoots.length === 0) {
        throw new Error('Authorize at least one project root before saving setup');
      }
      if ((certificatePem && !keyPem) || (!certificatePem && keyPem)) {
        throw new Error('Provide both TLS fields');
      }
      const updated = await props.api.updateSettings({
        setupRequired: false,
        deviceName,
        web: { host, port: Number(port), origin },
        ...(certificatePem && keyPem ? { tlsMaterial: { certificatePem, keyPem } } : {}),
      });
      props.onSaved(updated.settings);
      setCertificatePem('');
      setKeyPem('');
      setMessage(
        updated.restartRequired ? 'Saved. Restart Binaflow to apply network changes.' : 'Saved.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The settings could not be saved');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="settings-title">
      <p className="eyebrow">
        {mode === 'locations' ? 'Projects' : props.setup ? 'First start' : 'Local server'}
      </p>
      <h2 id="settings-title">
        {mode === 'locations'
          ? 'Project locations'
          : props.setup
            ? 'Set up Binaflow'
            : 'Server settings'}
      </h2>
      <p>
        {mode === 'locations'
          ? 'Choose which folders Binaflow can browse for projects. This does not modify their files.'
          : 'These settings belong to the computer running Binaflow.'}
      </p>
      {(mode === 'locations' || props.setup) && (
        <div className="settings-section" aria-labelledby="project-roots-title">
          <h3 id="project-roots-title">Folders Binaflow can browse</h3>
          <p>
            Binaflow can look for projects only inside these folders. Removing a folder keeps its
            registered projects and files.
          </p>
          {props.settings.projectRoots.length > 0 ? (
            <ul>
              {props.settings.projectRoots.map((root) => (
                <li key={root.id}>
                  <span>{root.label}</span>
                  {props.api.revokeProjectRoot && (
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => void revokeRoot(root.id)}
                      disabled={rootBusy !== undefined}
                    >
                      {rootBusy === root.id ? 'Removing...' : 'Remove authorization'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No folders are authorized.</p>
          )}
          {rootCandidates.length > 0 ? (
            <>
              <h3>Available local folders</h3>
              <ul>
                {rootCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <span>{candidate.label}</span>
                    <button
                      type="button"
                      onClick={() => void authorizeRoot(candidate.id)}
                      disabled={rootBusy !== undefined}
                    >
                      {rootBusy === candidate.id ? 'Authorizing...' : 'Authorize'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No additional local folders were detected.</p>
          )}
        </div>
      )}
      {mode !== 'locations' && (
        <>
          <label htmlFor="device-name">Computer name</label>
          <input
            id="device-name"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
          <label htmlFor="web-host">Host</label>
          <input id="web-host" value={host} onChange={(event) => setHost(event.target.value)} />
          <label htmlFor="web-port">Port</label>
          <input
            id="web-port"
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
          <label htmlFor="web-origin">Origin</label>
          <input
            id="web-origin"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          />
          <details>
            <summary>HTTPS certificate</summary>
            <p>
              Only configure TLS from this computer. Private keys are never returned to the browser.
            </p>
            <label htmlFor="certificate-pem">Certificate PEM</label>
            <textarea
              id="certificate-pem"
              value={certificatePem}
              onChange={(event) => setCertificatePem(event.target.value)}
            />
            <label htmlFor="key-pem">Private key PEM</label>
            <textarea
              id="key-pem"
              value={keyPem}
              onChange={(event) => setKeyPem(event.target.value)}
            />
          </details>
          <button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving...' : 'Save settings'}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
