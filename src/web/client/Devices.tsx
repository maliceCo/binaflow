import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, DeviceSummary } from './api.js';

export function Devices(props: { api: ApiClient }): ReactElement {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [offer, setOffer] = useState<{ code: string; expiresAt: number }>();
  const [busyDevice, setBusyDevice] = useState<string>();
  const [error, setError] = useState<string>();

  async function refresh(): Promise<void> {
    try {
      setDevices(await props.api.listDevices());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load devices');
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.api]);

  return (
    <section aria-labelledby="devices-title">
      <h2 id="devices-title">Paired computers</h2>
      <button
        type="button"
        onClick={async () => {
          try {
            setOffer(await props.api.beginPairing());
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not start pairing');
          }
        }}
      >
        Pair another computer
      </button>
      {offer && (
        <p role="status">
          Show this one-use code on the other computer: <strong>{offer.code}</strong>
        </p>
      )}
      <ul>
        {devices.map((device) => (
          <li key={device.id}>
            {device.name} ({device.status})
            {device.status === 'paired' && (
              <button
                type="button"
                disabled={busyDevice !== undefined}
                onClick={async () => {
                  setBusyDevice(device.id);
                  setError(undefined);
                  try {
                    await props.api.revokeDevice(device.id);
                    await refresh();
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : 'Could not revoke the device',
                    );
                  } finally {
                    setBusyDevice(undefined);
                  }
                }}
              >
                {busyDevice === device.id ? 'Revoking...' : 'Revoke'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
