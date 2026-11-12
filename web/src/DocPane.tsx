// The document side of a file: a rich-text editor (TipTap, MIT) saved as ProseMirror JSON in `file.document`.
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { getSchema, type Range } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import type { Block } from './api';
import { TEMPLATES } from './dsl/templates';
import { docExtensions, documentError } from './doc/extensions';
import { DiagramEmbedView, DocContext, typeLabel } from './doc/DiagramView';
import { SlashCommands } from './doc/SlashMenu';
import { renderBlock } from './canvas/render';
import type { ImageKind } from './export/actions';
import { blockItems, blocksAfterHistory, newBlockGeometry, diagramNode, embeddedBlockIds, isEmptyDoc, normalizeLink, SLASH_ITEMS, type SlashItem } from './doc/model';

type Props = {
  document: unknown;
  blocks: Block[];
  /** The canvas drawings, so a new diagram is placed clear of them. */
  canvas: unknown;
  dark: boolean;
  onDocument: (doc: unknown) => void;
  onBlocks: (b: Block[]) => void;
  /** Show a diagram block on the canvas. */
  onShow: (blockId: string) => void;
  /** Export one embedded diagram. */
  onExportBlock: (block: Block, kind: ImageKind) => void;
};

const newId = () => `b_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Remounted per file (App keys it), so it reads `document` only when it starts. A document the
 * editor cannot read is never saved over: the pane shows an error and stays read-only.
 */
export function DocPane({ document, blocks, canvas, dark, onDocument, onBlocks, onShow, onExportBlock }: Props) {
  const blocksRef = useRef(blocks);
  const onDocumentRef = useRef(onDocument);
  const onBlocksRef = useRef(onBlocks);
  blocksRef.current = blocks;
  onDocumentRef.current = onDocument;
  onBlocksRef.current = onBlocks;
  // Blocks made with `/새 다이어그램` here, so undo/redo of their embed takes them off / puts them back on the canvas.
  const created = useRef(new Map<string, Block>());
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  // Size of a new diagram's picture (the template), drawn ahead so `/새 다이어그램` can place it at once.
  const templateSize = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    void renderBlock({ id: '__template__', type: 'architecture', code: TEMPLATES.architecture, x: 0, y: 0, w: 0, h: 0 }, 'light').then((p) => {
      templateSize.current = p;
    });
  }, []);

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
            const geom = newBlockGeometry(templateSize.current, blocksRef.current, canvasRef.current);
            const b = { id, type: 'architecture', code: TEMPLATES.architecture, ...geom };
            created.current.set(id, b);
            onBlocksRef.current([...blocksRef.current, b]);
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

  // Checked before the editor starts: TipTap would otherwise open a broken document as an empty one,
  // and the first keystroke would save that over the file.
  const [broken, setBroken] = useState(() => documentError(document, getSchema(extensions)));
  const brokenRef = useRef(broken);

  const editor = useEditor({
    extensions,
    // Empty documents start as one empty paragraph (TipTap's own empty content passes its check).
    content: broken || isEmptyDoc(document) ? '' : (document as object),
    editable: !broken,
    enableContentCheck: true,
    onContentError: ({ error }) => {
      brokenRef.current = error.message;
      queueMicrotask(() => setBroken(error.message));
    },
    onCreate: ({ editor: e }) => {
      if (brokenRef.current) e.setEditable(false, false);
    },
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'doc-editor', 'aria-label': '문서 내용' } },
    onUpdate: ({ editor: e, transaction }) => {
      if (brokenRef.current) return;
      const json = e.getJSON();
      onDocumentRef.current(json);
      if (transaction.getMeta('history$')) {
        const next = blocksAfterHistory(embeddedBlockIds(transaction.before.toJSON()), embeddedBlockIds(json), created.current, blocksRef.current);
        if (next) onBlocksRef.current(next);
      }
    },
  });

  const inTable = useEditorState({ editor, selector: (s) => !!s.editor?.isActive('table') });
  const ctx = useMemo(() => ({ blocks, dark, onShow, onExport: onExportBlock }), [blocks, dark, onShow, onExportBlock]);

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
      {broken ? (
        <p role="alert" className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--accent-soft)' }}>
          이 파일의 문서 내용을 읽지 못했어요. 내용을 지키려고 문서는 고칠 수 없게 막아 두었어요. 캔버스는 그대로 쓸 수 있어요.
        </p>
      ) : (
        <DocContext.Provider value={ctx}>
          <EditorContent editor={editor} />
        </DocContext.Provider>
      )}
    </section>
  );
}
