import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  createRequestId,
  type ApiClient,
  type DeviceSummary,
  type ProjectSummary,
  type TransferStatus,
} from './api.js';
import { Transfers } from './Transfers.js';

const STORAGE_KEY = 'binaflow.transfer';

type TransferDraft = {
  transferId: string;
  requestId: string;
  projectId: string;
  targetProjectId: string;
  targetDeviceId: string;
};

export function TransferWizard(props: { api: ApiClient }): ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [draft, setDraft] = useState<TransferDraft>(() => loadDraft());
  const [preview, setPreview] = useState<unknown>();
  const [status, setStatus] = useState<TransferStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void Promise.all([props.api.listProjects(), props.api.listDevices()])
      .then(([nextProjects, nextDevices]) => {
        setProjects(nextProjects);
        setDevices(nextDevices.filter((device) => device.status === 'paired'));
        setDraft((current) => ({
          ...current,
          projectId: current.projectId || nextProjects[0]?.id || '',
          targetProjectId: current.targetProjectId || nextProjects[0]?.id || '',
          targetDeviceId:
            current.targetDeviceId ||
            nextDevices.find((device) => device.status === 'paired')?.id ||
            '',
        }));
      })
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [props.api]);

  useEffect(() => {
    if (!status || ['completed', 'failed', 'interrupted'].includes(status.stage)) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > 60) {
        window.clearInterval(timer);
        return;
      }
      void props.api
        .getTransfer(status.transferId)
        .then(setStatus)
        .catch((cause: unknown) => setError(messageOf(cause)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [props.api, status]);

  function updateDraft(patch: Partial<TransferDraft>): void {
    const next = { ...draft, ...patch };
    setDraft(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function doPreview(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const next = ensureDraft(draft);
      setDraft(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setPreview(await props.api.previewTransfer(command(next)));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function doStart(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const nextDraft = ensureDraft(draft);
      setDraft(nextDraft);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDraft));
      const next = await props.api.startTransfer(command(nextDraft, true));
      setStatus(next);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!draft.transferId) return;
    setBusy(true);
    try {
      setStatus(await props.api.getTransfer(draft.transferId));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resume(): Promise<void> {
    setBusy(true);
    try {
      setStatus(await props.api.resumeTransfer(draft.transferId));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ownership</p>
          <h2>Transfer project</h2>
        </div>
        {status && <span>{status.stage}</span>}
      </div>
      <p>
        Preview the handoff before confirming. Only the selected project and paired device are used.
      </p>
      <label>
        Source project
        <select
          value={draft.projectId}
          onChange={(event) => updateDraft({ projectId: event.target.value })}
        >
          <option value="">Select a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target project record
        <select
          value={draft.targetProjectId}
          onChange={(event) => updateDraft({ targetProjectId: event.target.value })}
        >
          <option value="">Select a target</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Paired target device
        <select
          value={draft.targetDeviceId}
          onChange={(event) => updateDraft({ targetDeviceId: event.target.value })}
        >
          <option value="">Select a device</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      </label>
      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => void doPreview()}>
          Preview
        </button>
        <button type="button" disabled={busy || !preview} onClick={() => void doStart()}>
          Confirm transfer
        </button>
      </div>
      {preview !== undefined && (
        <pre className="transfer-preview">{JSON.stringify(preview, null, 2)}</pre>
      )}
      <Transfers status={status} busy={busy} onRefresh={refresh} onResume={resume} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ensureDraft(draft: TransferDraft): TransferDraft {
  return {
    ...draft,
    transferId: draft.transferId || crypto.randomUUID(),
    requestId: draft.requestId || createRequestId(),
  };
}

function command(draft: TransferDraft, confirmed?: boolean): Record<string, unknown> {
  return {
    transferId: draft.transferId,
    requestId: draft.requestId,
    projectId: draft.projectId,
    targetProjectId: draft.targetProjectId,
    targetDeviceId: draft.targetDeviceId,
    ...(confirmed === undefined ? {} : { confirmed }),
  };
}

function loadDraft(): TransferDraft {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const value = JSON.parse(stored ?? '{}') as Partial<TransferDraft>;
    return {
      transferId: value.transferId ?? '',
      requestId: value.requestId ?? '',
      projectId: value.projectId ?? '',
      targetProjectId: value.targetProjectId ?? '',
      targetDeviceId: value.targetDeviceId ?? '',
    };
  } catch {
    return {
      transferId: '',
      requestId: '',
      projectId: '',
      targetProjectId: '',
      targetDeviceId: '',
    };
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Transfer request failed';
}
