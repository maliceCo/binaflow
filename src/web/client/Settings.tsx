import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, LauncherSettings } from './api.js';

export function Settings(props: {
  api: ApiClient;
  settings: LauncherSettings;
  onSaved: (settings: LauncherSettings) => void;
  setup?: boolean;
}): ReactElement {
  const [deviceName, setDeviceName] = useState(props.settings.deviceName);
  const [host, setHost] = useState(props.settings.web.host);
  const [port, setPort] = useState(String(props.settings.web.port));
  const [origin, setOrigin] = useState(props.settings.web.origin);
  const [certificatePem, setCertificatePem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const updated = await props.api.updateSettings({
        setupRequired: false,
        deviceName,
        web: { host, port: Number(port), origin },
      });
      let next = updated.settings;
      if (certificatePem || keyPem) {
        if (!certificatePem || !keyPem) throw new Error('Provide both TLS fields');
        next = await props.api.uploadTls(certificatePem, keyPem);
      }
      props.onSaved(next);
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
      <p className="eyebrow">{props.setup ? 'First start' : 'Local server'}</p>
      <h2 id="settings-title">{props.setup ? 'Set up Binaflow' : 'Web settings'}</h2>
      <p>These settings belong to the computer running Binaflow.</p>
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
      <input id="web-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} />
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
        <textarea id="key-pem" value={keyPem} onChange={(event) => setKeyPem(event.target.value)} />
      </details>
      <button type="button" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving...' : 'Save settings'}
      </button>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
