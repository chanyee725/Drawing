// The document side of a file: a rich-text editor (TipTap, MIT) saved as ProseMirror JSON in `file.document`.
import { useMemo, useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import type { Range } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import type { Block } from './api';
import { TEMPLATES } from './dsl/templates';
import { docExtensions } from './doc/extensions';
import { DiagramEmbedView, DocContext, typeLabel } from './doc/DiagramView';
import { SlashCommands } from './doc/SlashMenu';
import { blockItems, diagramNode, initialDocument, normalizeLink, SLASH_ITEMS, type SlashItem } from './doc/model';

type Props = {
  document: unknown;
  blocks: Block[];
  dark: boolean;
  onDocument: (doc: unknown) => void;
  onBlocks: (b: Block[]) => void;
  /** Show a diagram block on the canvas. */
  onShow: (blockId: string) => void;
};

const newId = () => `b_${Math.random().toString(36).slice(2, 10)}`;

/** Remounted per file (App keys it), so it reads `document` only when it starts. */
export function DocPane({ document, blocks, dark, onDocument, onBlocks, onShow }: Props) {
  const blocksRef = useRef(blocks);
  const onDocumentRef = useRef(onDocument);
  const onBlocksRef = useRef(onBlocks);
  blocksRef.current = blocks;
  onDocumentRef.current = onDocument;
  onBlocksRef.current = onBlocks;

  const extensions = useMemo(() => {
    const run = (editor: Editor, range: Range, item: SlashItem) => {
      const chain = () => editor.chain().focus().deleteRange(range);
      switch (item.command) {
        case 'h1':
        case 'h2':
        case 'h3':
          return chain().setNode('heading', { level: Number(item.command[1]) }).run();
        case 'bullet':
          return chain().toggleBulletList().run();
        case 'ordered':
          return chain().toggleOrderedList().run();
        case 'task':
          return chain().toggleTaskList().run();
        case 'code':
          return chain().setCodeBlock().run();
        case 'quote':
          return chain().setBlockquote().run();
        case 'rule':
          return chain().setHorizontalRule().run();
        case 'table':
          return chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        case 'link': {
          const typed = window.prompt('링크 주소를 입력해 주세요');
          if (typed === null) return chain().run();
          const href = normalizeLink(typed);
          if (!href) {
            window.alert('http, https, mailto 주소만 넣을 수 있어요');
            return chain().run();
          }
          return chain()
            .insertContent([{ type: 'text', text: typed.trim(), marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }])
            .run();
        }
        case 'diagram': {
          let id = item.blockId;
          if (!id) {
            id = newId();
            // w = 0 marks a block not yet on the canvas; the canvas gives it the picture's size and a free spot.
            onBlocksRef.current([...blocksRef.current, { id, type: 'architecture', code: TEMPLATES.architecture, x: 0, y: 0, w: 0, h: 0 }]);
          }
          // The embed is an atom: leave the cursor in a new line below it, so typing goes on instead of replacing it.
          return chain().insertContent(diagramNode(id)).createParagraphNear().run();
        }
      }
    };
    return [
      ...docExtensions(DiagramEmbedView),
      Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? '여기에 적어 보세요. /를 누르면 제목, 표, 다이어그램을 넣을 수 있어요' : '') }),
      SlashCommands.configure({ getItems: () => [...SLASH_ITEMS, ...blockItems(blocksRef.current, typeLabel)], run }),
    ];
  }, []);

  const editor = useEditor({
    extensions,
    content: initialDocument(document, blocks),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'doc-editor', 'aria-label': '문서 내용' } },
    onUpdate: ({ editor: e }) => onDocumentRef.current(e.getJSON()),
  });

  const inTable = useEditorState({ editor, selector: (s) => !!s.editor?.isActive('table') });
  const ctx = useMemo(() => ({ blocks, dark, onShow }), [blocks, dark, onShow]);

  const tableActions: [string, () => boolean][] = [
    ['행 추가', () => editor.chain().focus().addRowAfter().run()],
    ['열 추가', () => editor.chain().focus().addColumnAfter().run()],
    ['행 지우기', () => editor.chain().focus().deleteRow().run()],
    ['열 지우기', () => editor.chain().focus().deleteColumn().run()],
    ['표 지우기', () => editor.chain().focus().deleteTable().run()],
  ];

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-6" aria-label="문서">
      {inTable && (
        <div role="toolbar" aria-label="표" className="doc-table-bar">
          {tableActions.map(([label, act]) => (
            <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={act}>
              {label}
            </button>
          ))}
        </div>
      )}
      <DocContext.Provider value={ctx}>
        <EditorContent editor={editor} />
      </DocContext.Provider>
    </section>
  );
}
