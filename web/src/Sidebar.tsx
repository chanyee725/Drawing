import { useMemo, useRef, useState } from 'react';
import type { TreeNode } from './api';
import { dropTarget } from './movePaths';

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
      className="h-6 min-w-0 flex-1 rounded border px-1 text-sm outline-none"
      style={{ background: 'var(--surface)', borderColor: 'var(--accent)', color: 'var(--text)' }}
    />
  );
}

function Row({ node, depth, p }: { node: TreeNode; depth: number; p: Props }) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  const pad = { paddingLeft: 12 + depth * 14 };
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
        className="rounded px-1"
        style={{ color: 'var(--text-muted)' }}
      >
        ✎
      </button>
      <button
        type="button"
        aria-label={`${label} 지우기`}
        onClick={(e) => {
          e.stopPropagation();
          p.onDelete(node);
        }}
        className="rounded px-1"
        style={{ color: 'var(--text-muted)' }}
      >
        ×
      </button>
    </span>
  );
  const nameEl = renaming ? (
    <RenameInput
      initial={label}
      onDone={(v) => {
        setRenaming(false);
        if (v !== null && v.trim() !== label) p.onRename(node, v);
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
          onDragOver={(e) => {
            if (!canDrop()) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            if (!dragging || !canDrop()) return;
            e.preventDefault();
            e.stopPropagation();
            p.onMove(dragging, node.path);
          }}
          className="group flex h-8 cursor-pointer items-center gap-1 pr-2 text-sm"
          style={{ ...pad, background: over ? 'var(--accent-soft)' : undefined }}
        >
          <span aria-hidden>{open ? '▾' : '▸'}</span>
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
      aria-current={active ? 'page' : undefined}
      className="group flex h-8 cursor-pointer items-center gap-1 pr-2 text-sm"
      style={{ ...pad, background: active ? 'var(--accent-soft)' : undefined, color: active ? 'var(--accent)' : undefined }}
    >
      <span aria-hidden>▤</span>
      {nameEl}
      {!renaming && actions}
    </div>
  );
}

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterTree(p.tree, query.trim().toLowerCase()), [p.tree, query]);
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r" style={{ background: 'var(--elevated)', borderColor: 'var(--border)' }}>
      <div className="flex h-12 items-center gap-2 px-4 font-semibold">
        <span className="inline-block size-5 rounded-md" style={{ background: 'var(--accent)' }} aria-hidden />
        <span className="truncate">{p.workspace ?? 'Drawing'}</span>
      </div>
      <div className="px-3 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="파일 검색"
          aria-label="파일 검색"
          className="h-8 w-full rounded-md border px-2 text-sm outline-none"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </div>
      <div className="flex items-center gap-1 px-4 pt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="mr-auto">파일</span>
        <button type="button" onClick={p.onNewFolder} className="rounded px-1.5 hover:underline" aria-label="새 폴더">
          새 폴더
        </button>
        <button type="button" onClick={p.onNewFile} className="rounded px-1.5 text-base leading-none" aria-label="새 파일">
          +
        </button>
      </div>
      <nav
        className="min-h-0 flex-1 overflow-auto py-1"
        aria-label="파일 목록"
        onDragOver={(e) => {
          if (dragging && dropTarget(dragging, '') !== null) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!dragging || dropTarget(dragging, '') === null) return;
          e.preventDefault();
          p.onMove(dragging, '');
        }}
      >
        {shown.length === 0 ? (
          <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
            {query ? '찾는 파일이 없어요.' : '아직 파일이 없어요.'}
          </p>
        ) : (
          shown.map((n) => <Row key={n.path} node={n} depth={0} p={p} />)
        )}
      </nav>
      <button
        type="button"
        onClick={p.onToggleTheme}
        className="m-3 h-8 rounded-md border text-sm"
        style={{ borderColor: 'var(--border)' }}
      >
        {p.theme === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'}
      </button>
    </aside>
  );
}
