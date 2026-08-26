import { useEffect, useSyncExternalStore } from 'react';
import type { PiChat, PiChatSnapshot } from './store';

/** React binding for a PiChat: snapshot subscription plus its actions. */
export function usePiChat(
  chat: PiChat,
  opts: { resume: boolean },
): PiChatSnapshot & {
  sendMessage: PiChat['sendMessage'];
  setMessages: PiChat['setMessages'];
  addToolOutput: PiChat['addToolOutput'];
  addToolApprovalResponse: PiChat['addToolApprovalResponse'];
  stop: PiChat['stop'];
} {
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resume is decided once at mount
  useEffect(() => {
    if (opts.resume) chat.resume();
  }, [chat]);

  return {
    ...snapshot,
    sendMessage: chat.sendMessage,
    setMessages: chat.setMessages,
    addToolOutput: chat.addToolOutput,
    addToolApprovalResponse: chat.addToolApprovalResponse,
    stop: chat.stop,
  };
}
