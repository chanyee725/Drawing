import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { dslLanguage, highlightFor } from './dsl/language';
import { analyzeDiagram } from './dsl/adapter';

type Props = { code: string; type: string; dark: boolean; onChange: (code: string) => void };

const baseTheme = EditorView.theme({
  '&': { fontSize: '13px', background: 'var(--surface)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace', caretColor: 'var(--accent)' },
  '.cm-gutters': { background: 'var(--elevated)', color: 'var(--text-muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { background: 'var(--accent-soft)' },
  '&.cm-focused': { outline: '2px solid var(--accent)' },
  '.cm-scroller': { minHeight: '8rem' },
});

export function BlockEditor({ code, type, dark, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const hl = useRef(new Compartment());
  const typeRef = useRef(type);
  const onChangeRef = useRef(onChange);
  typeRef.current = type;
  onChangeRef.current = onChange;

  useEffect(() => {
    // Error markers come from the parser adapter; empty until E2 is connected.
    const lint = linter(
      (v): CmDiagnostic[] => {
        const doc = v.state.doc;
        return analyzeDiagram(typeRef.current, doc.toString()).diagnostics.map((d) => {
          const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
          const from = Math.min(line.from + Math.max((d.column ?? 1) - 1, 0), line.to);
          return { from, to: Math.max(from, line.to), severity: d.severity, message: d.message };
        });
      },
      { delay: 300 },
    );
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          indentOnInput(),
          dslLanguage,
          hl.current.of(highlightFor(dark)),
          baseTheme,
          lintGutter(),
          lint,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // The editor is created once per block; code/dark changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: hl.current.reconfigure(highlightFor(dark)) });
  }, [dark]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== code) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } });
  }, [code]);

  return <div ref={host} className="overflow-hidden rounded-md border" style={{ borderColor: 'var(--border)' }} />;
}
