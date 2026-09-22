import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, LocalDirectoryPage, LocalFilesystemRoot, ProjectSummary } from './api.js';
import { DialogFrame } from './DialogFrame.js';

export function LocalProjectPicker(props: {
  api: ApiClient;
  onOpened: (project: ProjectSummary) => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const [roots, setRoots] = useState<LocalFilesystemRoot[]>([]);
  const [path, setPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [directory, setDirectory] = useState<LocalDirectoryPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const browseGeneration = useRef(0);

  useEffect(() => {
    void props.api
      .listLocalFilesystemRoots()
      .then((next) => {
        setRoots(next);
        if (next[0]) void browse(next[0].path);
      })
      .catch((cause) => setError(messageOf(cause)));
  }, [props.api]);

  async function browse(nextPath: string): Promise<void> {
    if (busy || !nextPath) return;
    const generation = ++browseGeneration.current;
    setError(undefined);
    try {
      const next = await props.api.listLocalDirectory(nextPath);
      if (generation !== browseGeneration.current) return;
      setDirectory(next);
      setPath(next.currentPath);
      setPathInput(next.currentPath);
    } catch (cause) {
      if (generation === browseGeneration.current) setError(messageOf(cause));
    }
  }

  async function open(mode: 'open' | 'initialize'): Promise<void> {
    if (busy || !path) return;
    setBusy(true);
    setError(undefined);
    try {
      const project =
        mode === 'open'
          ? await props.api.openLocalProject(path)
          : await props.api.initializeLocalProject(path);
      await props.onOpened(project);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <DialogFrame
        className="settings-modal project-picker-modal"
        labelledBy="project-picker-title"
        onClose={props.onClose}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Projects</p>
            <h2 id="project-picker-title">Find or initialize a project</h2>
          </div>
          <button className="button-secondary" type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
        <form
          className="path-form"
          onSubmit={(event) => {
            event.preventDefault();
            void browse(pathInput.trim());
          }}
        >
          <label htmlFor="local-project-path">Folder path</label>
          <div>
            <input
              id="local-project-path"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
            />
            <button type="submit" disabled={busy || !pathInput.trim()}>
              Go
            </button>
          </div>
        </form>
        <div className="picker-roots" aria-label="Starting locations">
          {roots.map((root) => (
            <button
              key={root.path}
              className="button-secondary"
              type="button"
              onClick={() => void browse(root.path)}
            >
              {root.label}
            </button>
          ))}
        </div>
        {directory && (
          <>
            <div className="browser-path">
              <code>{directory.currentPath}</code>
              <button
                className="button-secondary"
                type="button"
                disabled={!directory.parentPath}
                onClick={() => directory.parentPath && void browse(directory.parentPath)}
              >
                ↑ Parent folder
              </button>
            </div>
            <ul className="local-folder-list">
              {directory.items.map((item) => (
                <li key={item.path}>
                  <button type="button" onClick={() => void browse(item.path)} disabled={busy}>
                    <span>▸</span>
                    <span>
                      {item.name}
                      {item.hasBinaflowConfig && <small>Binaflow project</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="picker-selection">
              <strong>{directory.currentPath}</strong>
              <p>
                {directory.hasBinaflowConfig
                  ? 'This project is already initialized.'
                  : 'Binaflow is not initialized here yet.'}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void open(directory.hasBinaflowConfig ? 'open' : 'initialize')}
              >
                {directory.hasBinaflowConfig ? 'Open project' : 'Initialize and open'}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </DialogFrame>
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The project folder could not be opened';
}
