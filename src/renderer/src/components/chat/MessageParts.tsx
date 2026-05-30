import type { AtriumUIMessage } from '@shared/chat';

/**
 * Renders an assistant message's parts. Step 5.b handles text only;
 * tool parts (5.d) and file parts (5.e) slot in here as new branches.
 */
export function MessageParts({ parts }: { parts: AtriumUIMessage['parts'] }): React.JSX.Element {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type !== 'text') return null;
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are an append-only stream with no stable id
        return <TextPart key={i} text={part.text} />;
      })}
    </>
  );
}

function TextPart({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="my-3 whitespace-pre-wrap text-base text-fg-primary leading-relaxed">{text}</div>
  );
}
