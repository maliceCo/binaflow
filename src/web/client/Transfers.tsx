import type { ReactElement } from 'react';
import type { TransferStatus } from './api.js';

export function Transfers(props: {
  status: TransferStatus | undefined;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onResume: () => Promise<void>;
}): ReactElement | null {
  if (!props.status) return null;
  return (
    <div className="transfer-status" aria-live="polite">
      <strong>Transfer {props.status.stage}</strong>
      <span>
        {props.status.bytesSent} bytes sent / {props.status.bytesReceived} bytes received
        {props.status.totalBytes === undefined ? '' : ` of ${props.status.totalBytes}`}
      </span>
      {props.status.errorCode && (
        <span className="error">Recovery required: {props.status.errorCode}</span>
      )}
      <div className="button-row">
        <button type="button" disabled={props.busy} onClick={() => void props.onRefresh()}>
          Refresh status
        </button>
        {props.status.stage !== 'completed' && (
          <button type="button" disabled={props.busy} onClick={() => void props.onResume()}>
            Resume transfer
          </button>
        )}
      </div>
    </div>
  );
}
