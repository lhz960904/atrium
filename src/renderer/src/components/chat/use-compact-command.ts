import type { AtriumUIMessage } from '@shared/chat';
import { FoldVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { useCompactionStore } from '../../state/compaction-store';
import type { SelectedModel } from '../../state/model-store';
import type { SlashCommand } from './composer/slash-menu';

type CompactDeps = {
  threadId: string;
  model: SelectedModel | null;
  endpoint: { baseUrl: string; token: string };
  setMessages: (messages: AtriumUIMessage[]) => void;
};

/**
 * The `/compact` command: summarize the thread's history into a checkpoint now,
 * showing the live indicator (and disabling the composer) via the compaction
 * store while it runs, then reload the persisted messages so the divider
 * appears. A fresh read is forced past the global staleTime cache.
 */
export function useCompactCommand({
  threadId,
  model,
  endpoint,
  setMessages,
}: CompactDeps): SlashCommand {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  return {
    name: 'Compact',
    description: t('command.compactDesc'),
    icon: FoldVertical,
    run: () => {
      if (!model || useCompactionStore.getState().active[threadId]) return;
      void (async () => {
        useCompactionStore.getState().setActive(threadId, true);
        try {
          await fetch(`${endpoint.baseUrl}/api/chat/${threadId}/compact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-atrium-token': endpoint.token },
            body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId }),
          });
          const fresh = await utils.threads.get.fetch({ id: threadId }, { staleTime: 0 });
          if (fresh) {
            setMessages(
              fresh.messages.map((m) => ({
                id: m.id,
                role: m.role,
                parts: m.parts as AtriumUIMessage['parts'],
                metadata: (m.metadata ?? undefined) as AtriumUIMessage['metadata'],
              })),
            );
          }
        } finally {
          useCompactionStore.getState().setActive(threadId, false);
        }
      })();
    },
  };
}
