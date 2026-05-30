import type { AtriumUIMessage } from '@shared/chat';
import { DefaultChatTransport } from 'ai';

/**
 * useChat transport pointing at the main process's localhost chat server.
 *
 * Sends only the latest message (AI SDK persistence best practice); the
 * server rebuilds history from the DB. `getExtra` is evaluated per send so
 * the current threadId + model are always current without recreating the
 * transport.
 */
export function makeChatTransport(
  baseUrl: string,
  token: string,
  getExtra: () => { threadId: string; providerId?: string; modelId?: string },
): DefaultChatTransport<AtriumUIMessage> {
  return new DefaultChatTransport<AtriumUIMessage>({
    api: `${baseUrl}/api/chat`,
    headers: { 'x-atrium-token': token },
    prepareSendMessagesRequest: ({ messages }) => ({
      body: { message: messages[messages.length - 1], ...getExtra() },
    }),
  });
}
