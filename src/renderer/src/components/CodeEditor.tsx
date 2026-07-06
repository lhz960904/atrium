import { json } from '@codemirror/lang-json';
import { unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { useThemeStore } from '../state/theme-store';

export type CodeEditorLanguage = 'json';

const languages: Record<CodeEditorLanguage, () => ReturnType<typeof json>> = { json };

/*
 * VS Code-style diff blocks. @codemirror/merge's base theme marks changes with
 * 2px underline gradients and near-invisible 8% line tints; these rules replace
 * that with solid, uniform line-level tints, the way VS Code / Cursor / Zed
 * render diffs. The `.cm-changedText`/`.cm-deletedText` marks must be kept and
 * neutralized (not removed) or the package's underline gradient resurfaces.
 * Colors ride the app's status tokens, so light/dark switching needs no
 * `&light`/`&dark` variants here. Theme rules are injected after the package's
 * base theme, so equal-specificity ties win.
 */
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, monospace)' },
  '&.cm-focused': { outline: 'none' },
  // The accent bar is an inset shadow so it sits inside the tinted block's
  // left edge (a gutter-rendered bar would sit outside it).
  '&.cm-merge-b .cm-changedLine': {
    backgroundColor: 'color-mix(in srgb, var(--color-success) 13%, transparent)',
    boxShadow: 'inset 3px 0 0 var(--color-success)',
  },
  '&.cm-merge-b .cm-changedText': { background: 'none' },
  '.cm-deletedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--color-danger) 11%, transparent)',
    boxShadow: 'inset 3px 0 0 var(--color-danger)',
  },
  '&.cm-merge-b .cm-deletedChunk .cm-deletedText': { background: 'none' },
});

/**
 * The app's shared CodeMirror editor: any editable code surface and any diff
 * review renders through this one component. With `diff`, it shows `original`
 * inline as deletions and highlights the edits on top, staying editable — the
 * same editor, a diff perspective. CodeMirror is driven imperatively, so state
 * syncing goes through refs; the editor mounts once and later prop changes
 * dispatch through compartments.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  original = '',
  diff = false,
  readOnly = false,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: CodeEditorLanguage;
  original?: string;
  diff?: boolean;
  readOnly?: boolean;
  className?: string;
}): React.JSX.Element {
  const dark = useThemeStore((s) => s.resolvedTheme === 'dark');
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageComp = useRef(new Compartment());
  const diffComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const readOnlyComp = useRef(new Compartment());
  // Keep onChange fresh without re-mounting the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount once; later syncs live in their own effects
  useEffect(() => {
    if (!parent.current) return;
    const v = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageComp.current.of(language ? languages[language]() : []),
          EditorView.lineWrapping,
          theme,
          themeComp.current.of(dark ? oneDark : []),
          diffComp.current.of([]),
          readOnlyComp.current.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  // External value changes (import / reset) replace the doc; internal edits are
  // already in sync, so the equality check keeps this from looping.
  useEffect(() => {
    const v = view.current;
    if (v && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageComp.current.reconfigure(language ? languages[language]() : []),
    });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({
      effects: diffComp.current.reconfigure(
        diff ? unifiedMergeView({ original, mergeControls: false, gutter: false }) : [],
      ),
    });
  }, [diff, original]);

  useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyComp.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [readOnly]);

  return <div ref={parent} className={className} />;
}
