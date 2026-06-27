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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const createThread = trpc.threads.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.threads.list.invalidate();
      navigate({ to: '/chat/$threadId', params: { threadId: id } });
    },
  });

  const start = (): void => {
    // The opener is the AI's first message, so the skill has no user reply to
    // detect language from — seed it from the UI language via a hidden tag
    // (UserMessage strips it from the bubble; the model still reads it).
    const lang = i18n.language.startsWith('zh') ? '简体中文' : 'English';
    usePendingInput.getState().set({
      text: `<skill-use>get-acquainted</skill-use>\n<reply-language>${lang}</reply-language>`,
      attachments: [],
    });
    createThread.mutate({ title: t('home.getAcquaintedTitle') });
  };

  return { start, isPending: createThread.isLoading };
}
