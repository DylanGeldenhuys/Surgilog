import { useRegisterSW } from 'virtual:pwa-register/react';
export function UpdateNotice() {
  const {
    needRefresh: [ready, setReady],
    updateServiceWorker,
  } = useRegisterSW();
  return ready ? (
    <div className="update-notice" role="status">
      <span>
        An app update is ready. Finish any open form before updating. Saved entries stay on this
        device.
      </span>
      <button className="button" onClick={() => void updateServiceWorker(true)}>
        Update app
      </button>
      <button className="text-button" onClick={() => setReady(false)}>
        Later
      </button>
    </div>
  ) : null;
}
