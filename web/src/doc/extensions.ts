// The document editor's schema: TipTap (MIT) extensions only, no React, so tests can load it in Node.
import { Extension, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import { Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { DIAGRAM_NODE, docShapeProblem, isEmptyDoc } from './model.ts';
import { headingsNeedingId, newHeadingId } from './outline.ts';

/** Node name of a `+` link (to a file, a heading or a diagram) in the document JSON. */
export const WIKILINK_NODE = 'wikilink';

/** Inline link made with `+`. It stores what it points at and the label shown; the web adds clicking. */
export const Wikilink = Node.create({
  name: WIKILINK_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    const attr = (name: string, def: string) => ({
      default: def,
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? def,
      renderHTML: (a: Record<string, unknown>) => ({ [`data-${name}`]: String(a[name] ?? def) }),
    });
    return { kind: attr('kind', 'file'), target: attr('target', ''), label: attr('label', '') };
  },
  parseHTML() {
    return [{ tag: 'a[data-wikilink]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-wikilink': '', class: 'doc-wikilink' }), String(node.attrs.label || node.attrs.target)];
  },
  renderText({ node }) {
    return String(node.attrs.label || node.attrs.target);
  },
});

/** Headings of this editor state: [position, current id] in document order. */
function headingsOf(doc: import('@tiptap/pm/model').Node): { pos: number; id: string | null }[] {
  const out: { pos: number; id: string | null }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === 'heading') out.push({ pos, id: (n.attrs.id as string | null) || null });
  });
  return out;
}

/**
 * Gives each heading its own link id (stored in the document, so a link keeps working after edits and reloads).
 * A heading without one, or repeating an earlier one (copy and paste), gets a new id after the next edit.
 */
export const HeadingId = Extension.create({
  name: 'headingId',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-heading-id'),
            renderHTML: (a) => (a.id ? { 'data-heading-id': a.id } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingId'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          return withHeadingIds(state.tr);
        },
      }),
    ];
  },
});

/** `tr` with new ids set on headings that lack one (or repeat one); null when none need it. */
export function withHeadingIds(tr: import('@tiptap/pm/state').Transaction): import('@tiptap/pm/state').Transaction | null {
  const heads = headingsOf(tr.doc);
  const need = headingsNeedingId(heads.map((h) => h.id));
  if (!need.length) return null;
  for (const i of need) {
    const node = tr.doc.nodeAt(heads[i].pos);
    if (node) tr.setNodeMarkup(heads[i].pos, undefined, { ...node.attrs, id: newHeadingId() });
  }
  // Ids are not an edit: undo must not take them off (a fresh id would break links copied meanwhile).
  return tr.setMeta('addToHistory', false);
}

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
    HeadingId,
    Wikilink,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    diagram,
  ];
}

/** Why a stored document does not fit the editor's schema (unknown node, bad nesting...), or null when it does. */
export function documentError(document: unknown, schema: Schema): string | null {
  const shape = docShapeProblem(document);
  if (shape) return shape;
  // An empty document is fine: the editor starts it with one empty paragraph.
  if (isEmptyDoc(document)) return null;
  try {
    PMNode.fromJSON(schema, document).check();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
