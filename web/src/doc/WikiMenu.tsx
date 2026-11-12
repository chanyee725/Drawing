// The `+` menu (wikilink): files, headings and diagrams. Typed at a line start or after a space.
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { menuRender } from './SlashMenu';
import { filterWiki, type WikiItem, type WikiKind } from './outline';
import { WIKILINK_NODE } from './extensions';

export type WikiOptions = {
  getItems: () => WikiItem[];
  /** A wikilink was clicked. */
  onOpen: (kind: WikiKind, target: string) => void;
};

export const WikiLinks = Extension.create<WikiOptions>({
  name: 'wikiLinks',
  addOptions() {
    return { getItems: () => [], onOpen: () => {} };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<WikiItem, WikiItem>({
        pluginKey: new PluginKey('wikiLinks'),
        editor: this.editor,
        char: '+',
        // Only at a line start or after a space ("1+1" stays text), and never in code.
        allowedPrefixes: [' '],
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterWiki(this.options.getItems(), query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: WikiItem }) =>
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: WIKILINK_NODE, attrs: { kind: props.kind, target: props.target, label: props.title } },
              { type: 'text', text: ' ' },
            ])
            .run(),
        render: menuRender<WikiItem>('연결할 곳'),
      }),
      // A click on a link opens it (Eraser: file, or pan to the figure / header).
      new Plugin({
        key: new PluginKey('wikiLinksClick'),
        props: {
          handleDOMEvents: {
            click: (_view, e) => {
              const el = (e.target as HTMLElement | null)?.closest?.('[data-wikilink]') as HTMLElement | null;
              if (!el) return false;
              e.preventDefault();
              this.options.onOpen(el.getAttribute('data-kind') as WikiKind, el.getAttribute('data-target') ?? '');
              return true;
            },
          },
        },
      }),
    ];
  },
});
