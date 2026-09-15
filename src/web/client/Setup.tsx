import type { ReactElement } from 'react';
import type { ApiClient, LauncherSettings } from './api.js';
import { Settings } from './Settings.js';

export function Setup(props: {
  api: ApiClient;
  settings: LauncherSettings;
  onSaved: (settings: LauncherSettings) => void;
}): ReactElement {
  return <Settings api={props.api} settings={props.settings} onSaved={props.onSaved} setup />;
}
