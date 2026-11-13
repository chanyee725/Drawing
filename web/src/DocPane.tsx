// The document side of a file: a rich-text editor (TipTap, MIT) saved as ProseMirror JSON in `file.document`.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { getSchema, type Range } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import type { Block, TreeNode } from './api';
import { TEMPLATES } from './dsl/templates';
import { docExtensions, documentError } from './doc/extensions';
import { DiagramEmbedView, DocContext, typeLabel } from './doc/DiagramView';
import { FrameEmbedView } from './doc/FrameView';
import { SlashCommands } from './doc/SlashMenu';
import { WikiLinks } from './doc/WikiMenu';
import { HeadingLinks } from './doc/HeadingLinks';
import { buildHash, fileItems, figureItems, headingItems, outlineOf, type WikiKind } from './doc/outline';
import { copyText } from './doc/clipboard';
import { renderBlock } from './canvas/render';
import type { ImageKind } from './export/actions';
import { blockItems, blocksAfterHistory, frameItems, framesOf, frameNode, type CanvasEl, newBlockGeometry, diagramNode, embeddedBlockIds, isEmptyDoc, normalizeLink, withTrailingParagraph, SLASH_ITEMS, type SlashItem } from './doc/model';
import { List } from 'lucide-react';
import { Button } from './components/ui/button';

type Props = {
  document: unknown;
  /** The blocks as drawn (id, type, code); a new array only when one of those changes, not when a block moves. */
  blocks: Block[];
  /** The latest blocks, positions included. */
  getBlocks: () => Block[];
  /** The latest canvas drawings, so a new diagram is placed clear of them. */
  getCanvas: () => unknown;
  dark: boolean;
  /** Workspace path of this file, and the workspace tree (for `+` links to other files). */
  path: string;
  tree: TreeNode[];
  /** Open another file of the workspace. */
  onOpenFile: (path: string) => void;
  /** Scroll to this heading id whenever `n` changes (a heading link was opened). */
  jump: { id: string; n: number } | null;
  /** Tell the user something short (a copied link). */
  onNotice: (message: string) => void;
  onDocument: (doc: unknown) => void;
  onBlocks: (b: Block[]) => void;
  /** Show a diagram block on the canvas. */
  onShow: (blockId: string) => void;
  /** Canvas frames and what sits in them, for frame embeds. */
  frameScene: CanvasEl[];
  /** Diagram blocks inside canvas frames, with their position. */
  frameBlocks: Block[];
  /** Show a canvas frame on the canvas. */
  onShowFrame: (frameId: string) => void;
  /** Export one embedded diagram. */
  onExportBlock: (block: Block, kind: ImageKind) => void;
};

/** Scroll to a heading by its link id (or by its place in the outline) and flash it. */
function scrollToHeading(editor: Editor | null, target: { id: string } | string | { index: number }, tries = 0) {
  if (!editor) return;
  const id = typeof target === 'string' ? target : 'id' in target ? target.id : null;
  const index = typeof target === 'object' && 'index' in target ? target.index : -1;
  let at = -1;
  let i = 0;
  editor.state.doc.descendants((n, pos) => {
    if (at >= 0 || n.type.name !== 'heading') return;
    if ((id && n.attrs.id === id) || i === index) at = pos;
    i += 1;
  });
  if (at < 0) return;
  let el: Node | null = null;
  try {
    el = editor.view.nodeDOM(at);
  } catch {
    // The editor view is not mounted yet.
    if (tries < 30) requestAnimationFrame(() => scrollToHeading(editor, target, tries + 1));
    return;
  }
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.classList.add('doc-h-flash');
  setTimeout(() => el.classList.remove('doc-h-flash'), 1500);
}

const newId = () => `b_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Remounted per file (App keys it), so it reads `document` only when it starts. A document the
 * editor cannot read is never saved over: the pane shows an error and stays read-only.
 */
export const DocPane = memo(function DocPane({ document, blocks, getBlocks, getCanvas, dark, path, tree, onOpenFile, jump, onNotice, onDocument, onBlocks, onShow, frameScene, frameBlocks, onShowFrame, onExportBlock }: Props) {
  const getBlocksRef = useRef(getBlocks);
  getBlocksRef.current = getBlocks;
  const onDocumentRef = useRef(onDocument);
  const onBlocksRef = useRef(onBlocks);
  onDocumentRef.current = onDocument;
  onBlocksRef.current = onBlocks;
  // Blocks made with `/새 다이어그램` here, so undo/redo of their embed takes them off / puts them back on the canvas.
  const created = useRef(new Map<string, Block>());
  const getCanvasRef = useRef(getCanvas);
  getCanvasRef.current = getCanvas;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const pathRef = useRef(path);
  pathRef.current = path;
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;
  const editorRef = useRef<Editor | null>(null);
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
        case 'frame':
          // Like the diagram embed: the cursor goes to a new line below.
          return item.frameId ? chain().insertContent(frameNode(item.frameId, item.frameName ?? '')).createParagraphNear().run() : chain().run();
        case 'diagram': {
          let id = item.blockId;
          if (!id) {
            id = newId();
            const geom = newBlockGeometry(templateSize.current, getBlocksRef.current(), getCanvasRef.current());
            const b = { id, type: 'architecture', code: TEMPLATES.architecture, ...geom };
            created.current.set(id, b);
            onBlocksRef.current([...getBlocksRef.current(), b]);
          }
          // The embed is an atom: leave the cursor in a new line below it, so typing goes on instead of replacing it.
          return chain().insertContent(diagramNode(id)).createParagraphNear().run();
        }
      }
    };
    return [
      ...docExtensions(DiagramEmbedView, FrameEmbedView),
      Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? '여기에 적어 보세요. /를 누르면 제목, 표, 다이어그램을 넣을 수 있어요' : '') }),
      HeadingLinks.configure({
        copy: (id) => {
          const url = `${window.location.origin}${window.location.pathname}${buildHash(pathRef.current, id)}`;
          void copyText(url).then((ok) => onNoticeRef.current(ok ? '제목 링크를 복사했어요' : '링크를 복사하지 못했어요'));
        },
      }),
      WikiLinks.configure({
        getItems: () => {
          // Headings get their id on every edit (typing "+" is one), so each one here can be linked.
          const outline = outlineOf(editorRef.current?.getJSON());
          return [...headingItems(outline), ...figureItems(getBlocksRef.current(), typeLabel), ...fileItems(treeRef.current).filter((f) => f.target !== pathRef.current)];
        },
        onOpen: (kind: WikiKind, target: string) => {
          if (kind === 'file') onOpenFileRef.current(target);
          else if (kind === 'figure') onShowRef.current(target);
          else scrollToHeading(editorRef.current, target);
        },
      }),
      SlashCommands.configure({ getItems: () => [...SLASH_ITEMS, ...blockItems(getBlocksRef.current(), typeLabel), ...frameItems(framesOf(getCanvasRef.current()))], run }),
    ];
  }, []);

  // Checked before the editor starts: TipTap would otherwise open a broken document as an empty one,
  // and the first keystroke would save that over the file.
  const [broken, setBroken] = useState(() => documentError(document, getSchema(extensions)));
  const brokenRef = useRef(broken);

  const editor = useEditor({
    extensions,
    // Empty documents start as one empty paragraph (TipTap's own empty content passes its check); others end in one.
    content: broken || isEmptyDoc(document) ? '' : (withTrailingParagraph(document) as object),
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
        const next = blocksAfterHistory(embeddedBlockIds(transaction.before.toJSON()), embeddedBlockIds(json), created.current, getBlocksRef.current(), !!(transaction.getMeta('history$') as { redo?: boolean }).redo);
        if (next) onBlocksRef.current(next);
      }
    },
  });

  editorRef.current = editor;
  useEffect(() => {
    if (jump) scrollToHeading(editor, jump.id);
  }, [editor, jump]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outline = useEditorState({ editor, selector: (s) => (s.editor ? outlineOf(s.editor.getJSON()) : []) });
  const inTable = useEditorState({ editor, selector: (s) => !!s.editor?.isActive('table') });
  const ctx = useMemo(() => ({ blocks, frameScene, frameBlocks, dark, onShow, onShowFrame, onExport: onExportBlock }), [blocks, frameScene, frameBlocks, dark, onShow, onShowFrame, onExportBlock]);

  const tableActions: [string, () => boolean][] = [
    ['행 추가', () => editor.chain().focus().addRowAfter().run()],
    ['열 추가', () => editor.chain().focus().addColumnAfter().run()],
    ['행 지우기', () => editor.chain().focus().deleteRow().run()],
    ['열 지우기', () => editor.chain().focus().deleteColumn().run()],
    ['표 지우기', () => editor.chain().focus().deleteTable().run()],
  ];

  const outlineMenu = (
    <div className="doc-outline-wrap">
      <Button variant="ghost" size="icon-sm" className="doc-outline-btn" aria-label="목차" title="목차" aria-expanded={outlineOpen} aria-controls="doc-outline" onClick={() => setOutlineOpen((o) => !o)}>
        <List aria-hidden />
      </Button>
      {outlineOpen && (
        <nav id="doc-outline" className="doc-outline" aria-label="목차">
          {outline.length === 0 ? (
            <p className="doc-outline-empty">제목이 없어요. 제목 1~3을 쓰면 여기에 나와요</p>
          ) : (
            <ul>
              {outline.map((h, i) => (
                <li key={`${h.id ?? 'x'}-${i}`} style={{ paddingLeft: `${(h.level - 1) * 14}px` }}>
                  <button type="button" onClick={() => scrollToHeading(editor, { index: i })}>
                    {h.text || '(제목 없음)'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      )}
    </div>
  );

  return (
    <section className="doc-pane mx-auto flex max-w-3xl flex-col gap-2 px-6 py-6" aria-label="문서">
      {!broken && outlineMenu}
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
        <p role="alert" className="rounded-md bg-muted px-3 py-2 text-sm">
          이 파일의 문서 내용을 읽지 못했어요. 내용을 지키려고 문서는 고칠 수 없게 막아 두었어요. 캔버스는 그대로 쓸 수 있어요.
        </p>
      ) : (
        <DocContext.Provider value={ctx}>
          <EditorContent editor={editor} />
        </DocContext.Provider>
      )}
    </section>
  );
});
