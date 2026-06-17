import { useNavigate } from '@tanstack/react-router';
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
  const createThread = trpc.threads.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.threads.list.invalidate();
      navigate({ to: '/chat/$threadId', params: { threadId: id } });
    },
  });

  const start = (): void => {
    usePendingInput
      .getState()
      .set({ text: '<skill-use>get-acquainted</skill-use>', attachments: [] });
    createThread.mutate({ title: t('home.getAcquaintedTitle') });
  };

  return { start, isPending: createThread.isLoading };
}
