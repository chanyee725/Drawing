import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, tooltips, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { linter, lintGutter, forceLinting, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { dslLanguage, highlightFor } from './dsl/language';
import { analyzeDiagram } from './dsl/adapter';
import { dslCompletionSource } from './dsl/completion';

type Props = { code: string; type: string; dark: boolean; onChange: (code: string) => void };

const baseTheme = EditorView.theme({
  '&': { fontSize: '13.5px', background: 'var(--muted)', color: 'var(--foreground)' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--brand)', padding: '6px 0' },
  '.cm-gutters': { background: 'transparent', color: 'var(--text-4)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { background: 'var(--brand-soft)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { minHeight: '8rem' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: 'var(--popover)', color: 'var(--popover-foreground)', border: 'none', borderRadius: '8px', boxShadow: 'var(--shadow-pop)', padding: '4px' },
  '.cm-tooltip-autocomplete ul li': { borderRadius: '4px', padding: '2px 6px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--brand-soft)', color: 'var(--foreground)' },
  '.cm-completionDetail': { color: 'var(--muted-foreground)', marginLeft: '0.75em', fontStyle: 'normal' },
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
    // Error markers come from the parser (via the adapter). Re-lint when the type changes.
    const lint = linter(
      (v): CmDiagnostic[] => {
        const doc = v.state.doc;
        const len = doc.length;
        return analyzeDiagram(typeRef.current, doc.toString()).diagnostics.map((d) => {
          const from = Math.min(d.offset, len);
          const to = Math.min(Math.max(d.offset + d.length, from + 1), len);
          return { from, to: Math.max(from, to), severity: d.severity, message: d.message };
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
          tooltips({ parent: document.body }),
          autocompletion({ override: [dslCompletionSource(() => typeRef.current)], icons: false }),
          lintGutter(),
          lint,
          keymap.of([indentWithTab, ...completionKeymap, ...defaultKeymap, ...historyKeymap]),
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
    if (view.current) forceLinting(view.current);
  }, [type]);

  useEffect(() => {
    view.current?.dispatch({ effects: hl.current.reconfigure(highlightFor(dark)) });
  }, [dark]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== code) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } });
  }, [code]);

  return <div ref={host} className="overflow-hidden rounded-md border border-input transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50" />;
}
