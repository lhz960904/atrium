import { UPDATE_STATE_CHANNEL, type UpdaterState } from '@shared/update';
import { useEffect } from 'react';
import { useUpdateStore } from '../state/update-store';
import { trpc } from './trpc';

/**
 * Keep the update store in sync with the main process: seed once from getState
 * (covers state that changed before this window mounted — e.g. the startup
 * check) and then follow the `update:state` broadcast for every later
 * transition. Mounted once at the app root.
 */
export function useUpdateSync(): void {
  const setState = useUpdateStore((s) => s.setState);
  const initial = trpc.update.getState.useQuery();

  useEffect(() => {
    if (initial.data) setState(initial.data);
  }, [initial.data, setState]);

  useEffect(() => {
    return window.electron?.ipcRenderer.on(UPDATE_STATE_CHANNEL, (_event, state: UpdaterState) =>
      setState(state),
    );
  }, [setState]);
}
