import { useMemo, useState } from 'react';
import type { TreeNode } from './api';

type Props = {
  workspace: string | null;
  tree: TreeNode[];
  current: string | null;
  onOpen: (path: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onDelete: (node: TreeNode) => void;
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

function Row({ node, depth, p }: { node: TreeNode; depth: number; p: Props }) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: 12 + depth * 14 };
  const del = (
    <button
      type="button"
      aria-label={`${displayName(node)} 지우기`}
      onClick={(e) => {
        e.stopPropagation();
        p.onDelete(node);
      }}
      className="ml-auto hidden rounded px-1 group-hover:block"
      style={{ color: 'var(--text-muted)' }}
    >
      ×
    </button>
  );
  if (node.type === 'folder') {
    return (
      <>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}
          className="group flex h-8 cursor-pointer items-center gap-1 pr-2 text-sm"
          style={pad}
        >
          <span aria-hidden>{open ? '▾' : '▸'}</span>
          <span className="truncate">{node.name}</span>
          {del}
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
      onClick={() => p.onOpen(node.path)}
      onKeyDown={(e) => e.key === 'Enter' && p.onOpen(node.path)}
      aria-current={active ? 'page' : undefined}
      className="group flex h-8 cursor-pointer items-center gap-1 pr-2 text-sm"
      style={{ ...pad, background: active ? 'var(--accent-soft)' : undefined, color: active ? 'var(--accent)' : undefined }}
    >
      <span aria-hidden>▤</span>
      <span className="truncate">{displayName(node)}</span>
      {del}
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
      <nav className="min-h-0 flex-1 overflow-auto py-1" aria-label="파일 목록">
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
