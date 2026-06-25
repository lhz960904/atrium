import { useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePendingInput } from '../state/pending-input-store';
import { trpc } from './trpc';

/**
 * Start the conversational onboarding: stash the get-acquainted skill trigger as
 * the next turn's input, open a fresh thread, and jump to it. Shared by the home
 * handshake card and the identity settings so the skill name lives in one place.
 */
export function useStartOnboarding(): { start: () => void; isPending: boolean } {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  // Synchronous re-entrancy lock: the mutation's isLoading only flips on the
  // next render, so a rapid second click would slip past a disabled-prop guard
  // and mint a second thread. A ref blocks it in the same tick.
  const startedRef = useRef(false);
  const createThread = trpc.threads.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.threads.list.invalidate();
      navigate({ to: '/chat/$threadId', params: { threadId: id } });
    },
    onError: () => {
      startedRef.current = false;
    },
  });

  const start = (): void => {
    if (startedRef.current) return;
    startedRef.current = true;
    usePendingInput
      .getState()
      .set({ text: '<skill-use>get-acquainted</skill-use>', attachments: [] });
    createThread.mutate({ title: t('home.getAcquaintedTitle') });
  };

  return { start, isPending: createThread.isLoading };
}
