import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, LauncherSettings } from './api.js';
import { Settings } from './Settings.js';

export function Setup(props: {
  api: ApiClient;
  settings: LauncherSettings;
  onSaved: (settings: LauncherSettings) => void;
}): ReactElement {
  const [settings, setSettings] = useState(props.settings);
  const [step, setStep] = useState<'locations' | 'server'>(
    props.settings.projectRoots.length > 0 ? 'server' : 'locations',
  );

  function update(next: LauncherSettings): void {
    setSettings(next);
    props.onSaved(next);
  }

  if (step === 'locations') {
    return (
      <main className="setup-flow">
        <p className="eyebrow">First start · 1 of 2</p>
        <h2>Where should Binaflow look for projects?</h2>
        <p className="setup-intro">
          Choose one or more folders. Binaflow will only browse inside the locations you select.
        </p>
        <Settings api={props.api} settings={settings} mode="locations" onSaved={update} />
        <button
          type="button"
          disabled={settings.projectRoots.length === 0}
          onClick={() => setStep('server')}
        >
          Continue to server settings
        </button>
      </main>
    );
  }

  return (
    <main className="setup-flow">
      <p className="eyebrow">First start · 2 of 2</p>
      <h2>Configure the local server</h2>
      <p className="setup-intro">
        These options control how Binaflow is available on this computer. They do not affect your
        project files.
      </p>
      <Settings api={props.api} settings={settings} onSaved={update} />
      <button className="button-secondary" type="button" onClick={() => setStep('locations')}>
        Back to project locations
      </button>
    </main>
  );
}
