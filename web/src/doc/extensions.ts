// The document editor's schema: TipTap (MIT) extensions only, no React, so tests can load it in Node.
import { Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { DIAGRAM_NODE } from './model.ts';

/** A canvas diagram block shown in the document. It stores only the block id; the picture is drawn live. */
export const DiagramEmbed = Node.create({
  name: DIAGRAM_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-block-id'),
        renderHTML: (a) => (a.blockId ? { 'data-block-id': a.blockId } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-diagram]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-diagram': '' })];
  },
});

/** Everything the document supports. `diagram` replaces DiagramEmbed (the web adds its node view). */
export function docExtensions(diagram: AnyExtension = DiagramEmbed): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Links open from the link itself (Ctrl/Cmd+click), not on every click while editing.
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    diagram,
  ];
}
