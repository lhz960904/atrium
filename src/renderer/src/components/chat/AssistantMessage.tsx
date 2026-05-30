import type { AtriumUIMessage } from '@shared/chat';
import { MessageParts } from './MessageParts';

export function AssistantMessage({
  parts,
}: {
  parts: AtriumUIMessage['parts'];
}): React.JSX.Element {
  return (
    <div className="mb-7">
      <MessageParts parts={parts} />
    </div>
  );
}
