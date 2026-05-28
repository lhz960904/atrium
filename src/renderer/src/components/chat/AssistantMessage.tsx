import type { Trace as TraceData } from '../../lib/chat-types';
import { Trace } from './Trace';

export function AssistantMessage({ trace }: { trace: TraceData }): React.JSX.Element {
  return (
    <div className="mb-7">
      <Trace trace={trace} />
    </div>
  );
}
