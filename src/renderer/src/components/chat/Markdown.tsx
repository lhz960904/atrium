import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import remarkMath from 'remark-math';
import {
  type AnimateOptions,
  type Components,
  defaultRemarkPlugins,
  Streamdown,
  type StreamdownProps,
} from 'streamdown';
import { CodeBlock } from './CodeBlock';
import { MathFence } from './KatexMath';
import { LinkChip } from './LinkChip';
import { MermaidDiagram } from './MermaidDiagram';
import { TableBlock } from './TableBlock';

// Math is opt-in in Streamdown. remark-math tags $$…$$ as `language-math`
// code; we render those with KaTeX in the code renderer below. Single-dollar
// math is disabled so dollar amounts in plain text don't parse as formulas.
const remarkPlugins: NonNullable<StreamdownProps['remarkPlugins']> = [
  ...Object.values(defaultRemarkPlugins),
  [remarkMath, { singleDollarTextMath: false }],
];

/**
 * Renders assistant text as Markdown via Streamdown — streaming-safe (it styles
 * unterminated blocks while tokens arrive), with GFM, KaTeX math, and Mermaid.
 * Colors come from our theme tokens (mapped in styles.css), so it follows
 * light/dark automatically.
 *
 * We override the tag renderers (react-markdown style) to drop Streamdown's
 * default code/table chrome and style everything with our own tokens.
 */
// `streaming` reaches the code renderer so Mermaid can tell an unfinished chart
// (keep showing source) from a settled one that won't parse (show the error).
function buildComponents(streaming: boolean): Components {
  return {
    // Multi-line code is a block (highlighted when a language is given, plain
    // otherwise); a single short snippet is an inline chip with a backing color.
    code: ({ className, children }) => {
      const cls = className ?? '';
      const text = String(children).replace(/\n$/, '');
      const lang = /language-(\w+)/.exec(cls)?.[1];
      // Math, either way it arrives: remark-math's tagged expression, or a model
      // that fenced it in ```latex / ```math / ```tex. MathFence handles both.
      if (lang === 'math' || lang === 'latex' || lang === 'tex') {
        return <MathFence source={text} className={cls} />;
      }
      if (lang === 'mermaid') {
        return <MermaidDiagram chart={text} streaming={streaming} />;
      }
      if (lang || text.includes('\n')) {
        return <CodeBlock code={text} lang={lang ?? 'text'} />;
      }
      return (
        <code className="rounded bg-code-bg px-1 py-0.5 font-mono text-[0.85em] text-fg-primary">
          {children}
        </code>
      );
    },
    // The default wraps code in a bordered container with a header; pass through
    // so only our CodeBlock's own <pre> remains.
    pre: ({ children }) => <>{children}</>,
    // Links render as favicon + label chips instead of raw URLs (Codex-style).
    a: ({ href, children }) => <LinkChip href={href}>{children}</LinkChip>,
    // A local file path in a Markdown image can't load in the chat (no file://
    // access), so it would show a broken-image box. Render it as a path chip
    // instead; web/data/blob URLs stay real images.
    img: ({ src, alt }) => {
      const url = typeof src === 'string' ? src : '';
      if (/^(https?:|data:|blob:)/.test(url)) {
        return (
          <img src={url} alt={alt ?? ''} className="my-2 max-h-[320px] max-w-full rounded-lg" />
        );
      }
      return (
        <code className="rounded bg-code-bg px-1 py-0.5 font-mono text-[0.85em] text-fg-primary">
          {alt ? `${alt}: ` : ''}
          {url}
        </code>
      );
    },
    table: ({ children }) => <TableBlock>{children}</TableBlock>,
    th: ({ children }) => (
      <th className="whitespace-nowrap border-border-default border-b bg-surface px-3 py-2 text-left font-medium text-fg-primary">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-border-default border-b px-3 py-2 text-fg-secondary">{children}</td>
    ),
  };
}

// While a turn streams, reveal newly mounted text at character granularity. A
// stagger would mount later characters as invisible spans first, which reads as
// blank gaps between paragraphs when chunks arrive in batches.
const STREAM_ANIM: AnimateOptions = {
  animation: 'fadeIn',
  sep: 'char',
  duration: 120,
  stagger: 0,
};

export function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}): React.JSX.Element {
  const components = useMemo(() => buildComponents(streaming), [streaming]);
  return (
    <Streamdown
      className="atrium-md leading-relaxed"
      controls={false}
      components={components}
      remarkPlugins={remarkPlugins}
      animated={streaming ? STREAM_ANIM : undefined}
      isAnimating={streaming}
    >
      {children}
    </Streamdown>
  );
}
