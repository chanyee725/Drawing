// App sidebar, layout B (design doc 6 §2.1, §3.1): workspace name with search and new-file icons, the views
// (모든 파일 A, 최근 R, 보관함 B), projects with their nested sub-documents, a one-line model connection summary
// and settings. Built from the shadcn Sidebar (components/ui/sidebar.tsx).
import { useEffect, useState } from 'react';
import { Archive, ChevronRight, Clock, File, Files, FolderClosed, Moon, MoreHorizontal, Pencil, Plus, Search, Settings, SquarePen, Sun, Trash2 } from 'lucide-react';
import { api, type DispatchStatus, type DocNode, type Project, type ProjectsView, type ProviderLimits, type ProviderState } from './api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { Kbd } from './components/ui/kbd';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from './components/ui/sidebar';
import { FOCUS_RING } from './lib/focus';
import { cn } from './lib/utils';
import { openPathsFor, percent, WARN_PERCENT, type Section } from './projectNav';

export const displayName = (n: { name: string; title?: string }) => n.title || n.name.replace(/\.dpx\.json$/, '');

type Props = {
  workspace: string | null;
  view: ProjectsView | null;
  section: Section;
  /** The open document's path while the document screen is shown. */
  current: string | null;
  onSection: (s: Section) => void;
  onOpen: (path: string) => void;
  onNewFile: () => void;
  onNewProject: () => void;
  onRename: (n: DocNode | Project) => void;
  onDelete: (n: DocNode | Project) => void;
  onArchive: () => void;
  onCommands: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  settingsOpen: boolean;
  onSettingsOpen: (open: boolean) => void;
};

const ICON_BUTTON = 'flex size-[30px] shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground max-md:size-11 [&>svg]:size-[17px] ' + FOCUS_RING;

/** First letter of a project, shown on a muted square (no per-project colour, doc 6 §4.1). */
function ProjectMark({ p }: { p: Project }) {
  const letter = p.icon || [...p.name][0]?.toUpperCase() || '?';
  return (
    <span aria-hidden className="grid size-[17px] shrink-0 place-items-center overflow-hidden rounded-sm bg-muted text-[11px] font-bold text-foreground">
      {letter}
    </span>
  );
}

function RowMenu({ label, node, p }: { label: string; node: DocNode | Project; p: Props }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover aria-label={`${label} 메뉴`} className="right-1">
          <MoreHorizontal />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        <DropdownMenuItem onSelect={() => p.onRename(node)}>
          <Pencil className="size-4" /> 이름 바꾸기
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => p.onDelete(node)}>
          <Trash2 className="size-4" /> 지우기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocRows({ nodes, depth, open, toggle, p }: { nodes: DocNode[]; depth: number; open: Set<string>; toggle: (path: string) => void; p: Props }) {
  return (
    <>
      {nodes.map((n) => {
        const label = n.type === 'doc' ? displayName(n) : n.name;
        const has = n.children.length > 0;
        const expanded = has && open.has(n.path);
        const active = n.type === 'doc' && p.current === n.path;
        // Indent: 9px + icon column (22px) + 15px per level (doc 6 prototype), within the row's own 8px padding.
        const pad = { paddingLeft: 9 + 22 + depth * 15 };
        return (
          <SidebarMenuItem key={n.path}>
            <SidebarMenuButton
              style={pad}
              aria-current={active ? 'page' : undefined}
              aria-expanded={n.type === 'group' ? expanded : undefined}
              className="pr-14 font-normal text-muted-foreground hover:text-foreground aria-[current=page]:font-medium"
              onClick={() => (n.type === 'doc' ? p.onOpen(n.path) : toggle(n.path))}
            >
              {n.type === 'doc' ? <File className="size-[15px]! text-muted-foreground" aria-hidden /> : <FolderClosed className="size-[15px]! text-muted-foreground" aria-hidden />}
              <span className="truncate">{label}</span>
              {has && !expanded && <SidebarMenuBadge aria-label={`하위 ${n.count}개`}>{n.count}</SidebarMenuBadge>}
            </SidebarMenuButton>
            {has && n.type === 'doc' && (
              <SidebarMenuAction aria-label={`${label} 하위 문서 ${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} className="right-7 max-md:right-11" onClick={() => toggle(n.path)}>
                <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} />
              </SidebarMenuAction>
            )}
            <RowMenu label={label} node={n} p={p} />
            {expanded && (
              <SidebarMenuSub>
                <DocRows nodes={n.children} depth={depth + 1} open={open} toggle={toggle} p={p} />
              </SidebarMenuSub>
            )}
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

const PROVIDERS = [
  ['claude', 'Claude'],
  ['openai', 'Codex'],
  ['gemini', 'Gemini'],
] as const;

type ModelLine = { id: string; name: string; connected: boolean; pct: number | null; reached: boolean };

/** Connection and 5-hour usage per provider. GET only: nothing here starts or logs in a CLI. */
function useModels(): { status: DispatchStatus | null; lines: ModelLine[] } {
  const [status, setStatus] = useState<DispatchStatus | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderState>>({});
  const [limits, setLimits] = useState<ProviderLimits>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.dispatch();
        if (!alive) return;
        setStatus(s);
        if (!s.enabled) return;
        const [pv, lim] = await Promise.all([api.providers(), api.limits().catch(() => ({}))]);
        if (!alive) return;
        setProviders(pv);
        setLimits(lim);
      } catch {
        if (alive) setStatus({ enabled: false });
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const lines = PROVIDERS.map(([id, name]) => {
    const connected = !!providers[id]?.connected;
    const windows = id === 'claude' ? limits.claude?.windows : id === 'openai' ? limits.openai?.windows : undefined;
    return { id, name, connected, pct: connected ? percent(windows?.[0]?.used) : null, reached: id === 'gemini' && connected && !!limits.gemini?.reached };
  });
  return { status, lines };
}

function ModelStrip() {
  const { status, lines } = useModels();
  if (!status) return null;
  if (!status.enabled) {
    return (
      <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground" title={status.message}>
        <i aria-hidden className="size-2 shrink-0 rounded-full bg-idle" />
        모델 연결 꺼짐
      </p>
    );
  }
  const text = (m: ModelLine) => (!m.connected ? '연결 안 됨' : m.reached ? '한도 도달' : m.pct != null ? `5시간 한도 ${m.pct}% 사용` : '연결됨');
  return (
    <ul aria-label="모델 연결" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-xs text-muted-foreground">
      {lines.map((m) => {
        const warn = m.reached || (m.pct != null && m.pct > WARN_PERCENT);
        return (
          <li key={m.id} className="inline-flex items-center gap-1.5" aria-label={`${m.name} ${text(m)}`} title={`${m.name}: ${text(m)}`}>
            <i aria-hidden className={cn('size-2 rounded-full', !m.connected ? 'bg-idle' : warn ? 'bg-warn' : 'bg-ok')} />
            {m.name}
            {m.connected && m.pct != null && <span className="tabular-nums">{m.pct}%</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar(p: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // The open document's project and parents unfold when it changes (the user can fold them again).
  useEffect(() => {
    const need = openPathsFor(p.view, p.current);
    if (need.length) setOpen((o) => (need.every((x) => o.has(x)) ? o : new Set([...o, ...need])));
  }, [p.view, p.current]);
  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const views = [
    { id: 'all', label: '모든 파일', icon: Files, key: 'A', run: () => p.onSection({ kind: 'all' }) },
    { id: 'recent', label: '최근', icon: Clock, key: 'R', run: () => p.onSection({ kind: 'recent' }) },
    { id: 'archive', label: '보관함', icon: Archive, key: 'B', run: p.onArchive },
  ] as const;
  const projects = p.view?.projects ?? [];
  return (
    <SidebarRoot label="사이드바">
      <SidebarHeader className="flex-row items-center gap-1 pt-[9px]">
        <div className="flex h-[35px] min-w-0 flex-1 items-center gap-2 px-2">
          <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
            {[...(p.workspace ?? 'D')][0]?.toUpperCase()}
          </span>
          <span className="truncate text-sm font-semibold">{p.workspace ?? 'Drawing'}</span>
        </div>
        <button type="button" className={ICON_BUTTON} aria-label="찾기 (Ctrl K)" title="찾기 (Ctrl K)" onClick={p.onCommands}>
          <Search />
        </button>
        <button type="button" className={cn(ICON_BUTTON, 'border bg-background text-text-2')} aria-label="새 파일 (N)" title="새 파일 (N)" onClick={p.onNewFile}>
          <SquarePen />
        </button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {views.map((v) => (
            <SidebarMenuItem key={v.id}>
              <SidebarMenuButton aria-current={p.section.kind === v.id ? 'page' : undefined} onClick={v.run} className="group/row">
                <v.icon aria-hidden />
                <span className="truncate">{v.label}</span>
                <Kbd className="ml-auto opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 max-md:hidden">{v.key}</Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <SidebarGroup className="mt-3">
          <SidebarGroupLabel>프로젝트</SidebarGroupLabel>
          <SidebarGroupAction aria-label="새 프로젝트" title="새 프로젝트" onClick={p.onNewProject}>
            <Plus />
          </SidebarGroupAction>
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{p.view ? '아직 프로젝트가 없어요.' : '불러오는 중이에요…'}</p>
          ) : (
            <SidebarMenu>
              {projects.map((pr) => {
                const expanded = open.has(pr.path);
                const here = p.section.kind === 'project' && p.section.path === pr.path;
                return (
                  <SidebarMenuItem key={pr.path}>
                    <SidebarMenuButton
                      aria-current={here ? 'page' : undefined}
                      aria-expanded={expanded}
                      className="pr-14"
                      onClick={() => {
                        p.onSection({ kind: 'project', path: pr.path });
                        if (!expanded) toggle(pr.path);
                      }}
                    >
                      <ProjectMark p={pr} />
                      <span className="truncate">{pr.name}</span>
                      {!expanded && pr.count > 0 && <SidebarMenuBadge>{pr.count}</SidebarMenuBadge>}
                    </SidebarMenuButton>
                    <SidebarMenuAction aria-label={`${pr.name} ${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} className="right-7 max-md:right-11" onClick={() => toggle(pr.path)}>
                      <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} />
                    </SidebarMenuAction>
                    <RowMenu label={pr.name} node={pr} p={p} />
                    {expanded && (
                      <SidebarMenuSub>
                        {pr.docs.length ? (
                          <DocRows nodes={pr.docs} depth={0} open={open} toggle={toggle} p={p} />
                        ) : (
                          <li className="py-1 pl-[31px] text-xs text-muted-foreground">아직 문서가 없어요.</li>
                        )}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <ModelStrip />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu open={p.settingsOpen} onOpenChange={p.onSettingsOpen}>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="group/row">
                  <Settings aria-hidden />
                  <span className="truncate">설정</span>
                  <Kbd className="ml-auto opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 max-md:hidden">,</Kbd>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem onSelect={p.onToggleTheme}>
                  {p.theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {p.theme === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </SidebarRoot>
  );
}
