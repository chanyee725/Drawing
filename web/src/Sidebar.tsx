import { useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, FolderPlus, Moon, Pencil, Plus, Sun, Trash, X } from 'lucide-react';
import type { TreeNode } from './api';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { cn } from './lib/utils';
import { dropTarget, renameInitial } from './movePaths';

const DRAG_TYPE = 'application/x-drawing-node';

type Props = {
  workspace: string | null;
  tree: TreeNode[];
  current: string | null;
  onOpen: (path: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onDelete: (node: TreeNode) => void;
  /** Move `node` into folder `dir` ('' = workspace root). */
  onMove: (node: TreeNode, dir: string) => void;
  /** Rename `node` to the typed name (same folder). */
  onRename: (node: TreeNode, name: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onTrash: () => void;
};

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'folder') {
      const kids = filterTree(n.children, q);
      if (kids.length || n.name.toLowerCase().includes(q)) out.push({ ...n, children: kids });
    } else if ((n.title || n.name).toLowerCase().includes(q) || n.name.toLowerCase().includes(q)) {
      out.push(n);
    }
  }
  return out;
}

export const displayName = (n: { name: string; title?: string }) => n.title || n.name.replace(/\.dpx\.json$/, '');

// Tree rows: 28px, inset and rounded, neutral hover; the open file gets the brand tint.
const ROW =
  'group flex h-(--h-row) cursor-pointer items-center gap-1.5 rounded-md pr-1 text-sm text-text-2 outline-none select-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';
const ROW_ACTION = 'flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground';
const FOOT_ROW =
  'flex h-(--h-row) w-full items-center gap-2 rounded-md px-2 text-left text-sm text-text-2 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

// The node being dragged (dataTransfer cannot be read during dragover, so keep it here).
let dragging: TreeNode | null = null;

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label="새 이름"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') finish(value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(value)}
      className="h-6 min-w-0 flex-1 rounded-sm border border-brand bg-background px-1 text-sm text-foreground outline-none"
    />
  );
}

function Row({ node, depth, p }: { node: TreeNode; depth: number; p: Props }) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  const pad = { paddingLeft: 8 + depth * 14 };
  const label = displayName(node);
  const actions = (
    <span className="ml-auto hidden shrink-0 group-hover:flex group-focus-within:flex">
      <button
        type="button"
        aria-label={`${label} 이름 바꾸기`}
        onClick={(e) => {
          e.stopPropagation();
          setRenaming(true);
        }}
        className={ROW_ACTION}
      >
        <Pencil className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`${label} 지우기`}
        onClick={(e) => {
          e.stopPropagation();
          p.onDelete(node);
        }}
        className={ROW_ACTION}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
  const nameEl = renaming ? (
    <RenameInput
      initial={renameInitial(node)}
      onDone={(v) => {
        setRenaming(false);
        if (v !== null && v.trim() !== renameInitial(node)) p.onRename(node, v);
      }}
    />
  ) : (
    <span className="truncate">{label}</span>
  );
  const drag = {
    draggable: !renaming,
    onDragStart: (e: React.DragEvent) => {
      dragging = node;
      e.dataTransfer.setData(DRAG_TYPE, node.path);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      dragging = null;
      setOver(false);
    },
  };
  const keys = (activate: () => void) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') activate();
    else if (e.key === 'F2') setRenaming(true);
  };
  if (node.type === 'folder') {
    const canDrop = () => !!dragging && dropTarget(dragging, node.path) !== null;
    return (
      <>
        <div
          role="button"
          tabIndex={0}
          {...drag}
          onClick={() => !renaming && setOpen(!open)}
          onKeyDown={keys(() => setOpen(!open))}
          onDoubleClick={() => setRenaming(true)}
          // A row never lets a drag bubble to the list background, or a refused drop would move the item to the root.
          onDragOver={(e) => {
            e.stopPropagation();
            if (!canDrop()) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.stopPropagation();
            setOver(false);
            const d = dragging;
            dragging = null;
            if (!d || dropTarget(d, node.path) === null) return;
            e.preventDefault();
            p.onMove(d, node.path);
          }}
          className={cn(ROW, over && 'bg-brand-soft hover:bg-brand-soft')}
          style={pad}
        >
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          {nameEl}
          {!renaming && actions}
        </div>
        {open && node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} p={p} />)}
      </>
    );
  }
  const active = p.current === node.path;
  return (
    <div
      role="button"
      tabIndex={0}
      {...drag}
      onClick={() => !renaming && p.onOpen(node.path)}
      onKeyDown={keys(() => p.onOpen(node.path))}
      onDoubleClick={() => setRenaming(true)}
      // Dropping on a file does nothing (and must not reach the list background, which means "root").
      onDragOver={(e) => e.stopPropagation()}
      onDrop={(e) => {
        e.stopPropagation();
        dragging = null;
      }}
      aria-current={active ? 'page' : undefined}
      className={cn(ROW, active && 'bg-brand-soft font-medium text-foreground hover:bg-brand-soft')}
      style={pad}
    >
      <FileText aria-hidden className={cn('size-3.5 shrink-0', active ? 'text-brand' : 'text-muted-foreground')} />
      {nameEl}
      {!renaming && actions}
    </div>
  );
}

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterTree(p.tree, query.trim().toLowerCase()), [p.tree, query]);
  return (
    <aside className="flex w-(--w-sidebar) shrink-0 flex-col border-r bg-panel">
      <div className="flex h-(--h-bar) items-center gap-2 px-3 text-sm font-semibold">
        <span className="inline-block size-5 shrink-0 rounded-md bg-brand" aria-hidden />
        <span className="truncate">{p.workspace ?? 'Drawing'}</span>
      </div>
      <div className="px-2 pb-1">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="파일 검색" aria-label="파일 검색" className="h-(--h-row) bg-background" />
      </div>
      <div className="flex h-(--h-row) items-center gap-0.5 pt-2 pr-2 pl-4 text-xs font-medium text-muted-foreground">
        <span className="mr-auto">파일</span>
        <Button variant="ghost" size="icon-sm" onClick={p.onNewFolder} aria-label="새 폴더" title="새 폴더" className="size-6 text-muted-foreground">
          <FolderPlus className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={p.onNewFile} aria-label="새 파일" title="새 파일" className="size-6 text-muted-foreground">
          <Plus className="size-3.5" />
        </Button>
      </div>
      <nav
        className="min-h-0 flex-1 overflow-auto px-2 py-1"
        aria-label="파일 목록"
        onDragOver={(e) => {
          if (dragging && dropTarget(dragging, '') !== null) e.preventDefault();
        }}
        onDrop={(e) => {
          const d = dragging;
          dragging = null;
          if (!d || dropTarget(d, '') === null) return;
          e.preventDefault();
          p.onMove(d, '');
        }}
      >
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{query ? '찾는 파일이 없어요.' : '아직 파일이 없어요.'}</p>
        ) : (
          shown.map((n) => <Row key={n.path} node={n} depth={0} p={p} />)
        )}
      </nav>
      <div className="flex flex-col gap-0.5 border-t p-2">
        <button type="button" onClick={p.onTrash} className={FOOT_ROW}>
          <Trash aria-hidden className="size-3.5 text-muted-foreground" />
          최근에 지운 파일
        </button>
        <button type="button" onClick={p.onToggleTheme} className={FOOT_ROW}>
          {p.theme === 'dark' ? <Sun aria-hidden className="size-3.5 text-muted-foreground" /> : <Moon aria-hidden className="size-3.5 text-muted-foreground" />}
          {p.theme === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'}
        </button>
      </div>
    </aside>
  );
}
