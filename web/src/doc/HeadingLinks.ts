// A small "link" button at the start of every heading that copies a link to it (hash: #file=<path>&h=<id>).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { withHeadingIds } from './extensions';

export type HeadingLinkOptions = { copy: (headingId: string) => void };

export const HeadingLinks = Extension.create<HeadingLinkOptions>({
  name: 'headingLinks',
  addOptions() {
    return { copy: () => {} };
  },
  addProseMirrorPlugins() {
    const copy = (id: string) => this.options.copy(id);
    return [
      new Plugin({
        key: new PluginKey('headingLinks'),
        props: {
          decorations: (state) => {
            const decos: Decoration[] = [];
            state.doc.descendants((n, pos) => {
              if (n.type.name !== 'heading') return;
              decos.push(
                Decoration.widget(
                  pos + 1,
                  (view, getPos) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'doc-h-link';
                    b.contentEditable = 'false';
                    b.textContent = '#';
                    b.title = '이 제목의 링크 복사';
                    b.setAttribute('aria-label', '이 제목의 링크 복사');
                    b.addEventListener('mousedown', (e) => e.preventDefault());
                    b.addEventListener('click', (e) => {
                      e.preventDefault();
                      const at = (getPos() ?? 1) - 1;
                      // A heading from before links existed has no id yet: give it one first.
                      let node = view.state.doc.nodeAt(at);
                      if (node && !node.attrs.id) {
                        const tr = withHeadingIds(view.state.tr);
                        if (tr) view.dispatch(tr);
                        node = view.state.doc.nodeAt(at);
                      }
                      const id = node?.attrs.id as string | undefined;
                      if (!id) return;
                      copy(id);
                      b.textContent = '✓';
                      setTimeout(() => (b.textContent = '#'), 1200);
                    });
                    return b;
                  },
                  { side: -1, key: `hl-${pos}-${n.attrs.id ?? ''}`, ignoreSelection: true },
                ),
              );
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
