import katex from 'katex';

/**
 * Renders a LaTeX expression with KaTeX. remark-math turns `$$…$$` into code
 * nodes tagged `language-math` (+ `math-inline` / `math-display`); we render
 * them here instead of letting them fall through as code.
 */
export function KatexMath({ tex, display }: { tex: string; display: boolean }): React.JSX.Element {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false });
  return display ? (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output with throwOnError off
    <div className="my-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output with throwOnError off
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

const MATH = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/**
 * Renders any math the model produces, both shapes:
 *  - remark-math tagged it `math-inline` / `math-display` — `source` is the
 *    bare expression and the className carries the mode; render it directly.
 *  - the model fenced it (```latex / ```math / ```tex) — `source` is raw and
 *    still holds the $…$ / $$…$$ delimiters; pull each one out and render it,
 *    keeping the text in between. Bare LaTeX with no delimiters is one block.
 */
export function MathFence({
  source,
  className = '',
}: {
  source: string;
  className?: string;
}): React.JSX.Element {
  if (className.includes('math-inline')) return <KatexMath tex={source} display={false} />;
  if (className.includes('math-display')) return <KatexMath tex={source} display />;
  if (!source.includes('$')) return <KatexMath tex={source.trim()} display />;

  const parts: React.JSX.Element[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null = MATH.exec(source);
  while (m !== null) {
    const between = source.slice(last, m.index);
    if (between.trim()) parts.push(<span key={`t${i}`}>{between}</span>);
    const [, display, inline] = m;
    if (display != null) parts.push(<KatexMath key={i} tex={display.trim()} display />);
    else if (inline != null) parts.push(<KatexMath key={i} tex={inline.trim()} display={false} />);
    last = m.index + m[0].length;
    i++;
    m = MATH.exec(source);
  }
  const tail = source.slice(last);
  if (tail.trim()) parts.push(<span key="tail">{tail}</span>);
  return <>{parts}</>;
}
