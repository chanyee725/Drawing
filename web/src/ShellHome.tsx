// Main panel outside the document screen (floating frame B): 모든 파일, 최근 and a project home.
// A plain list for now; the dashboard and project home layouts (tabs, quick create, grouped lists) are E42 ② (design doc 6 §9).
import { File, Menu, SquarePen } from 'lucide-react';
import type { DocNode, ProjectsView } from './api';
import { Button } from './components/ui/button';
import { SidebarTrigger } from './components/ui/sidebar';
import { FOCUS_RING } from './lib/focus';
import { displayName } from './Sidebar';
import type { Section } from './projectNav';

type Props = { section: Exclude<Section, { kind: 'doc' }>; view: ProjectsView | null; narrow: boolean; onOpen: (path: string) => void; onNewFile: () => void };

const flat = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => [...(n.type === 'doc' ? [n] : []), ...flat(n.children)]);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function ShellHome({ section, view, narrow, onOpen, onNewFile }: Props) {
  const project = section.kind === 'project' ? view?.projects.find((p) => p.path === section.path) : undefined;
  const title = section.kind === 'all' ? '모든 파일' : section.kind === 'recent' ? '최근' : (project?.name ?? '프로젝트');
  const where = (path: string) => {
    const p = view?.projects.find((x) => path.startsWith(`${x.path}/`));
    return p ? p.name : '미분류';
  };
  let rows: DocNode[] = [];
  let empty = '아직 파일이 없어요.';
  if (view) {
    const all = [...view.projects.flatMap((p) => flat(p.docs)), ...flat(view.loose)];
    if (section.kind === 'recent') rows = all.sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? '')).slice(0, 20);
    else if (section.kind === 'all') rows = all.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    else if (project) {
      rows = flat(project.docs);
      empty = '아직 문서가 없어요.';
    }
  }
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 max-md:px-1">
        {narrow && (
          <SidebarTrigger aria-label="메뉴 열기">
            <Menu className="size-[17px]" />
          </SidebarTrigger>
        )}
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        <Button variant="ghost" size="icon-sm" className={`ml-auto max-md:size-11 ${FOCUS_RING}`} aria-label="새 파일" title="새 파일 (N)" onClick={onNewFile}>
          <SquarePen className="size-[17px]" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {project?.description && <p className="px-4 pt-3 text-sm text-muted-foreground">{project.description}</p>}
        {!view ? (
          <p className="p-4 text-sm text-muted-foreground">불러오는 중이에요…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="py-1">
            {rows.map((d) => (
              <li key={d.path}>
                <button
                  type="button"
                  onClick={() => onOpen(d.path)}
                  className={`flex h-[41px] w-full items-center gap-3 border-b px-4 text-left text-sm outline-none hover:bg-accent max-md:h-11 ${FOCUS_RING}`}
                >
                  <File aria-hidden className="size-[17px] shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{displayName(d)}</span>
                  {section.kind !== 'project' && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{where(d.path)}</span>}
                  <span className="w-36 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">{when(d.modified)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
