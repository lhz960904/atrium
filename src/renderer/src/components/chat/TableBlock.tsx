import { useRef } from 'react';
import { extractTableDataFromElement, tableDataToMarkdown } from 'streamdown';
import { CopyButton } from './CopyButton';

/**
 * A Markdown table on our own surface (row separators, no outer box) with a
 * hover-revealed copy button that exports the rendered table back to Markdown.
 */
export function TableBlock({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLTableElement>(null);
  const copy = (): string =>
    ref.current ? tableDataToMarkdown(extractTableDataFromElement(ref.current)) : '';

  return (
    <div className="my-3">
      {/* Action toolbar above the table — copy now, download later. */}
      <div className="mb-1 flex justify-end">
        <CopyButton text={copy} />
      </div>
      <div className="overflow-x-auto">
        <table ref={ref} className="w-full border-collapse text-sm">
          {children}
        </table>
      </div>
    </div>
  );
}
