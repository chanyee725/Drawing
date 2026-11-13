// Dashboard ("모든 파일") and project home: data loading, tabs, quick-create chips. Layout B of
// docs/design/dispatch-integration/6-app-shell-projects.md §3.1. Built from shadcn Tabs / Button / DropdownMenu.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FilePlus2, FileText, FolderClosed, Layers, Menu, PenTool, Plus, Search, Workflow } from 'lucide-react';
import { projectsApi, type ProjectDoc, type ProjectInfo, type ProjectsResponse } from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { SidebarTrigger } from '../components/ui/sidebar';
import { Kbd } from '../components/ui/kbd';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ColumnHead, DocList, FileList } from './DocList';
import { CHORD_MS, RECENT_LIMIT, allDocs, badgeOf, chord, filterDocs, flatFiles, flattenRows, matchesQuery, relativeTime, type DashTab } from './model';

export type CreateKind = 'doc' | 'canvas' | 'plan' | 'template';
export type HomeProps = {
  /** null = dashboard; a project id = that project's home. */
  project: string | null;
  /** Bumps when the workspace changed, to refetch. */
  version: unknown;
  onProject: (id: string | null) => void;
  onOpen: (path: string) => void;
  onCreate: (kind: CreateKind, project: string | null) => void;
  onDelete: (path: string, title: string) => void;
  /** Narrow screen: the sidebar is a drawer, so the header carries its button. */
  narrow?: boolean;
};


function useProjects(version: unknown) {
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    projectsApi
      .projects()
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [version]);
  return { data, failed };
}

const CHIPS: { kind: CreateKind; label: string; key: string; icon: typeof FileText; soon?: boolean }[] = [
  { kind: 'doc', label: '문서', key: 'D', icon: FileText },
  { kind: 'canvas', label: '캔버스', key: 'C', icon: PenTool },
  { kind: 'plan', label: '파이프라인 계획', key: 'P', icon: Workflow },
  { kind: 'template', label: '템플릿', key: 'T', icon: Layers, soon: true },
];

/** Single-letter shortcuts, only while no input, dialog or menu has focus. */
function useCreateKeys(on: boolean, run: (k: CreateKind) => void, focusSearch: () => void) {
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable], [role=dialog], [role=menu]') || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === 'p' && Date.now() - chord.g < CHORD_MS) return; // G P belongs to the project menu
      if (key === '/') {
        e.preventDefault();
        focusSearch();
        return;
      }
      const chip = CHIPS.find((c) => c.key.toLowerCase() === key && !c.soon);
      if (chip) {
        e.preventDefault();
        run(chip.kind);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [on, run, focusSearch]);
}

function useCollapse() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (p: string) =>
      setCollapsed((s) => {
        const n = new Set(s);
        if (!n.delete(p)) n.add(p);
        return n;
      }),
    [],
  );
  return { collapsed, toggle };
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-2 py-10 text-center text-sm text-muted-foreground">{children}</p>;

export function Home(props: HomeProps) {
  const { data, failed } = useProjects(props.version);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const focusSearch = useCallback(() => search.current?.focus(), []);
  const project = props.project ? data?.projects.find((p) => p.id === props.project) ?? null : null;
  const { onCreate } = props;
  useCreateKeys(true, useCallback((k) => onCreate(k, props.project), [onCreate, props.project]), focusSearch);
  useEffect(() => setQuery(''), [props.project]);

  if (failed) return <Empty>목록을 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.</Empty>;
  if (!data) return <Empty>불러오는 중이에요</Empty>;
  if (props.project && !project) return (
    <Empty>
      이 프로젝트를 찾지 못했어요.{' '}
      <Button variant="link" className="h-auto p-0" onClick={() => props.onProject(null)}>모든 파일로 가기</Button>
    </Empty>
  );
  return (
    <main className="min-h-0 flex-1 scroll-pt-[39px] overflow-auto" data-screen={project ? 'project' : 'dashboard'}>
      {project ? (
        <ProjectHome {...props} data={data} info={project} query={query} onQuery={setQuery} search={search} />
      ) : (
        <Dashboard {...props} data={data} query={query} onQuery={setQuery} search={search} />
      )}
    </main>
  );
}

type Shared = Omit<HomeProps, "project"> & { data: ProjectsResponse; query: string; onQuery: (q: string) => void; search: React.RefObject<HTMLInputElement | null> };

function SearchBox({ value, onChange, inputRef, placeholder, wide }: { value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement | null>; placeholder: string; wide?: boolean }) {
  return (
    <div role="search" className={wide ? 'relative w-full' : 'relative ml-auto w-52 max-w-full'}>
      <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" aria-hidden />
      <Input ref={inputRef} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} aria-keyshortcuts="/" className="pr-8 pl-8" />
      {!value && <Kbd className="pointer-events-none absolute top-1.5 right-1.5" aria-hidden>/</Kbd>}
    </div>
  );
}

/** Head of a 39px group: letter badge, name, document count, and an optional + (sticky while its rows scroll). */
function GroupHead({ badge, name, count, onName, onAdd }: { badge: React.ReactNode; name: string; count: number; onName?: () => void; onAdd?: () => void }) {
  return (
    <div data-slot="group-head" className="sticky top-0 z-10 flex h-[39px] items-center gap-2 border-b bg-[color-mix(in_oklch,var(--muted)_50%,var(--background))] pr-3 pl-4">
      <h2 className="m-0 flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
        {badge}
        {onName ? (
          <button type="button" className="truncate rounded-sm hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" onClick={onName}>
            {name}
          </button>
        ) : (
          <span className="truncate">{name}</span>
        )}
        <span className="font-normal tabular-nums">
          <span className="sr-only">문서 </span>
          {count}
          <span className="sr-only">개</span>
        </span>
      </h2>
      {onAdd && (
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`${name}에 새 문서`} title={`${name}에 새 문서`} onClick={onAdd}>
          <Plus />
        </Button>
      )}
    </div>
  );
}

const LetterBadge = ({ children }: { children: React.ReactNode }) => (
  <span aria-hidden className="grid size-[17px] shrink-0 place-items-center rounded-sm bg-muted text-xs leading-none font-bold text-foreground">
    {children}
  </span>
);

function Dashboard({ data, query, onQuery, search, ...p }: Shared) {
  const [tab, setTab] = useState<DashTab>('projects');
  const { collapsed, toggle } = useCollapse();
  const files = useMemo(() => flatFiles(data.projects, data.unfiled), [data]);
  const empty = files.length === 0;
  const found = files.filter((f) => matchesQuery(f.title, query));
  const noMatch = <Empty>맞는 파일이 없어요</Empty>;
  const tree = (docs: ProjectDoc[], label: string) => <DocList rows={flattenRows(filterDocs(docs, query), collapsed)} label={label} onOpen={p.onOpen} onToggle={toggle} onDelete={p.onDelete} />;
  const unfiled = () => {
    const shown = filterDocs(data.unfiled, query);
    return shown.length > 0 && (
      <section aria-label="미분류">
        <GroupHead badge={<FolderClosed className="size-4 shrink-0" aria-hidden />} name="미분류" count={allDocs([], data.unfiled).length} />
        {tree(data.unfiled, '미분류')}
      </section>
    );
  };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as DashTab)} className="gap-0">
      <header className="flex min-h-12 items-center gap-3 border-b px-4 py-2">
        {p.narrow && (
          <SidebarTrigger aria-label="메뉴 열기">
            <Menu className="size-[17px]" />
          </SidebarTrigger>
        )}
        <h1 className="m-0 shrink-0 text-[15px] font-semibold">모든 파일</h1>
        {/* One row; on a narrow screen the pills scroll sideways instead of wrapping. */}
        <TabsList aria-label="보기" className="min-w-0 shrink justify-start overflow-x-auto [scrollbar-width:none] [&>*]:flex-none">
          <TabsTrigger value="all">전체</TabsTrigger>
          <TabsTrigger value="recent">최근</TabsTrigger>
          <TabsTrigger value="projects">프로젝트별</TabsTrigger>
          <TabsTrigger value="unfiled">미분류</TabsTrigger>
        </TabsList>
        {!p.narrow && <SearchBox value={query} onChange={onQuery} inputRef={search} placeholder="파일 찾기" />}
      </header>
      {p.narrow && (
        <div className="border-b px-3 py-2">
          <SearchBox value={query} onChange={onQuery} inputRef={search} placeholder="파일 찾기" wide />
        </div>
      )}
      <div role="group" aria-label="새로 만들기" className="flex items-center gap-1.5 overflow-x-auto border-b px-4 py-2.5 [scrollbar-width:none]">
        <span className="mr-1 hidden shrink-0 text-[13px] text-muted-foreground sm:inline">새로 만들기</span>
        {CHIPS.map(({ kind, label, key, icon: Icon, soon }) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            disabled={soon}
            title={soon ? '준비 중이에요' : `새 ${label} (${key})`}
            aria-keyshortcuts={soon ? undefined : key}
            data-create={kind}
            onClick={() => p.onCreate(kind, null)}
            className="shrink-0 border-dashed font-medium text-muted-foreground hover:border-solid hover:text-foreground"
          >
            <Icon /> {label} <Kbd>{key}</Kbd>
          </Button>
        ))}
      </div>
      {empty ? (
        <Empty>아직 파일이 없어요. 위에서 새 문서를 만들어 보세요.</Empty>
      ) : (
        <>
          <TabsContent value="all">
            {found.length === 0 ? noMatch : <><ColumnHead location /><FileList files={found} label="모든 파일" onOpen={p.onOpen} onDelete={p.onDelete} /></>}
          </TabsContent>
          <TabsContent value="recent">
            {(() => {
              const shown = found.slice(0, RECENT_LIMIT);
              return shown.length === 0 ? noMatch : <><ColumnHead location /><FileList files={shown} label="최근에 고친 파일" onOpen={p.onOpen} onDelete={p.onDelete} /></>;
            })()}
          </TabsContent>
          <TabsContent value="projects">
            <ColumnHead />
            {data.projects.map((pr) => {
              if (query.trim() && filterDocs(pr.docs, query).length === 0) return null;
              return (
                <section key={pr.id} aria-label={pr.name} data-group={pr.id}>
                  <GroupHead badge={<LetterBadge>{badgeOf(pr)}</LetterBadge>} name={pr.name} count={pr.docCount} onName={() => p.onProject(pr.id)} onAdd={() => p.onCreate('doc', pr.id)} />
                  {pr.docs.length === 0 ? <p className="m-0 border-b py-2.5 pl-12 text-[13px] text-muted-foreground">아직 문서가 없어요</p> : tree(pr.docs, pr.name)}
                </section>
              );
            })}
            {unfiled()}
            {query.trim() && found.length === 0 && noMatch}
          </TabsContent>
          <TabsContent value="unfiled">
            {filterDocs(data.unfiled, query).length === 0 ? (
              <Empty>{query.trim() ? '맞는 파일이 없어요' : '미분류 파일이 없어요. 모든 파일이 프로젝트 안에 있어요.'}</Empty>
            ) : (
              <>
                <ColumnHead />
                {tree(data.unfiled, '미분류')}
              </>
            )}
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}

type PTab = 'docs' | 'pipelines' | 'overview';

function ProjectHome({ info: project, query, onQuery, search, ...p }: Shared & { info: ProjectInfo }) {
  const [tab, setTab] = useState<PTab>('docs');
  const { collapsed, toggle } = useCollapse();
  const rows = flattenRows(filterDocs(project.docs, query), collapsed);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as PTab)} className="gap-0">
      <header className="flex min-h-12 flex-wrap items-center gap-3 border-b px-4 py-2">
        {p.narrow && (
          <SidebarTrigger aria-label="메뉴 열기">
            <Menu className="size-[17px]" />
          </SidebarTrigger>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="모든 파일로 돌아가기" onClick={() => p.onProject(null)}>
          <ArrowLeft />
        </Button>
        <span aria-hidden className="text-base">{project.icon}</span>
        <h1 className="m-0 text-[15px] font-semibold">{project.name}</h1>
        <TabsList aria-label="프로젝트 보기">
          <TabsTrigger value="docs">문서</TabsTrigger>
          <TabsTrigger value="pipelines">파이프라인</TabsTrigger>
          <TabsTrigger value="overview">개요</TabsTrigger>
        </TabsList>
        <SearchBox value={query} onChange={onQuery} inputRef={search} placeholder="이 프로젝트에서 찾기" />
        <Button size="sm" onClick={() => p.onCreate('doc', project.id)}>
          <Plus /> 새 문서
        </Button>
      </header>
      <div className="pb-3">
        <TabsContent value="docs">
          {project.docs.length === 0 ? (
            <Empty>
              <FilePlus2 className="mx-auto mb-2 size-5" aria-hidden />
              이 프로젝트에는 아직 문서가 없어요. 새 문서를 만들어 보세요.
            </Empty>
          ) : rows.length === 0 ? (
            <Empty>맞는 문서가 없어요</Empty>
          ) : (
            <>
              <ColumnHead />
              <DocList rows={rows} label={`${project.name} 문서`} onOpen={p.onOpen} onToggle={toggle} onDelete={p.onDelete} />
            </>
          )}
        </TabsContent>
        <TabsContent value="pipelines">
          <Empty>이 프로젝트에서 실행한 파이프라인이 아직 없어요. 계획 문서에서 시작하기를 누르면 여기에 보여요.</Empty>
        </TabsContent>
        <TabsContent value="overview">
          <dl className="m-0 grid max-w-xl grid-cols-[6rem_1fr] gap-x-4 gap-y-2 px-2 text-sm">
            <dt className="text-muted-foreground">설명</dt>
            <dd className="m-0">{project.description || '설명이 없어요'}</dd>
            <dt className="text-muted-foreground">문서</dt>
            <dd className="m-0">{project.docCount}개</dd>
            <dt className="text-muted-foreground">폴더</dt>
            <dd className="m-0 font-mono text-[13px]">{project.path}/</dd>
            <dt className="text-muted-foreground">고친 때</dt>
            <dd className="m-0">{relativeTime(project.modifiedAt)}</dd>
          </dl>
        </TabsContent>
      </div>
    </Tabs>
  );
}

