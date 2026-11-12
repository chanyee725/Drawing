// The `/` insert menu: TipTap's suggestion plugin (MIT) with a small React list.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { filterSlash, type SlashItem } from './model';

type ListProps = { items: SlashItem[]; command: (item: SlashItem) => void };
type ListHandle = { onKeyDown: (e: KeyboardEvent) => boolean };

const SlashList = forwardRef<ListHandle, ListProps>(function SlashList({ items, command }, ref) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [items]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === 'ArrowDown') setActive((i) => (i + 1) % items.length);
      else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + items.length) % items.length);
      else if (e.key === 'Enter' || e.key === 'Tab') command(items[active]);
      else return false;
      return true;
    },
  }));
  return (
    <div ref={list} role="listbox" aria-label="넣을 블록" className="doc-slash">
      {items.length === 0 ? (
        <p className="doc-slash-empty">맞는 항목이 없어요</p>
      ) : (
        items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            // mousedown keeps the editor's selection; click would blur it first.
            onMouseDown={(e) => {
              e.preventDefault();
              command(it);
            }}
          >
            <span>{it.title}</span>
            <span className="doc-slash-hint">{it.hint}</span>
          </button>
        ))
      )}
    </div>
  );
});

export type SlashOptions = {
  getItems: () => SlashItem[];
  run: (editor: Editor, range: Range, item: SlashItem) => void;
};

export const SlashCommands = Extension.create<SlashOptions>({
  name: 'slashCommands',
  addOptions() {
    return { getItems: () => [], run: () => {} };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: new PluginKey('slashCommands'),
        editor: this.editor,
        char: '/',
        // Not inside code: a slash there is just a slash.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterSlash(this.options.getItems(), query),
        command: ({ editor, range, props }) => this.options.run(editor, range, props),
        render: () => {
          let comp: ReactRenderer<ListHandle, ListProps> | null = null;
          let unmount: (() => void) | undefined;
          const props = (p: SuggestionProps<SlashItem, SlashItem>): ListProps => ({ items: p.items, command: (it) => p.command(it) });
          return {
            onStart: (p) => {
              comp = new ReactRenderer(SlashList, { props: props(p), editor: p.editor });
              unmount = p.mount(comp.element as HTMLElement);
            },
            onUpdate: (p) => comp?.updateProps(props(p)),
            onKeyDown: (p: SuggestionKeyDownProps) => (p.event.key === 'Escape' ? false : (comp?.ref?.onKeyDown(p.event) ?? false)),
            onExit: () => {
              unmount?.();
              comp?.destroy();
              comp = null;
            },
          };
        },
      }),
    ];
  },
});
