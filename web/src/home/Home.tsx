// Dashboard ("모든 파일") and project home: data loading, tabs, quick-create chips. Layout B of
// docs/design/dispatch-integration/6-app-shell-projects.md §3.1. Built from shadcn Tabs / Button / DropdownMenu.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FilePlus2, FileText, Layers, PenTool, Plus, Search, Workflow } from 'lucide-react';
import { projectsApi, type ProjectInfo, type ProjectsResponse, type RecentFile } from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Kbd } from '../components/ui/kbd';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DocList } from './DocList';
import { CHORD_MS, ROW_HEIGHT, allDocs, chord, recentFiles, filterDocs, flattenRows, matchesQuery, relativeTime, type DashTab } from './model';

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
  const recent = useMemo<RecentFile[]>(() => (data ? recentFiles(data.projects, data.unfiled) : []), [data]);
  return { data, recent, failed };
}

const CHIPS: { kind: CreateKind; label: string; key: string; icon: typeof FileText; soon?: boolean }[] = [
  { kind: 'doc', label: '새 문서', key: 'D', icon: FileText },
  { kind: 'canvas', label: '새 캔버스', key: 'C', icon: PenTool },
  { kind: 'plan', label: '새 파이프라인 계획', key: 'P', icon: Workflow },
  { kind: 'template', label: '템플릿에서 만들기', key: 'T', icon: Layers, soon: true },
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
  const { data, recent, failed } = useProjects(props.version);
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
    <main className="min-h-0 flex-1 overflow-auto" data-screen={project ? 'project' : 'dashboard'}>
      {project ? (
        <ProjectHome {...props} data={data} info={project} query={query} onQuery={setQuery} search={search} />
      ) : (
        <Dashboard {...props} data={data} recent={recent} query={query} onQuery={setQuery} search={search} />
      )}
    </main>
  );
}

type Shared = Omit<HomeProps, "project"> & { data: ProjectsResponse; query: string; onQuery: (q: string) => void; search: React.RefObject<HTMLInputElement | null> };

function SearchBox({ value, onChange, inputRef, placeholder }: { value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement | null>; placeholder: string }) {
  return (
    <div className="relative ml-auto w-48 max-w-full">
      <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" />
      <Input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-8" />
    </div>
  );
}

function Dashboard({ data, recent, query, onQuery, search, ...p }: Shared & { recent: RecentFile[] }) {
  const [tab, setTab] = useState<DashTab>('all');
  const { collapsed, toggle } = useCollapse();
  const docs = useMemo(() => allDocs(data.projects, data.unfiled), [data]);
  const empty = docs.length === 0;
  const list = (rows: ReturnType<typeof flattenRows>, label: string) => <DocList rows={rows} label={label} onOpen={p.onOpen} onToggle={toggle} onDelete={p.onDelete} />;
  const shownRecent = recent.filter((r) => matchesQuery(r.title, query));

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as DashTab)} className="gap-0">
      <header className="flex min-h-[44px] flex-wrap items-center gap-3 border-b px-4 py-1.5">
        <h1 className="m-0 text-[15px] font-semibold">모든 파일</h1>
        <TabsList aria-label="보기">
          <TabsTrigger value="all">전체</TabsTrigger>
          <TabsTrigger value="recent">최근</TabsTrigger>
          <TabsTrigger value="projects">프로젝트별</TabsTrigger>
          <TabsTrigger value="unfiled">미분류</TabsTrigger>
        </TabsList>
        <SearchBox value={query} onChange={onQuery} inputRef={search} placeholder="이 목록에서 찾기 ( / )" />
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2" aria-label="빠른 만들기">
        {CHIPS.map(({ kind, label, key, icon: Icon, soon }) => (
          <Button key={kind} variant="outline" size="sm" disabled={soon} title={soon ? '준비 중이에요' : undefined} onClick={() => p.onCreate(kind, null)} className="border-dashed">
            <Icon /> {label} <Kbd>{key}</Kbd>
          </Button>
        ))}
      </div>
      <div className="px-3 py-3">
        {empty ? (
          <Empty>아직 파일이 없어요. 위에서 새 문서를 만들어 보세요.</Empty>
        ) : (
          <>
            <TabsContent value="all">
              {data.projects.map((pr) => {
                const rows = flattenRows(filterDocs(pr.docs, query), collapsed);
                if (rows.length === 0) return null;
                return (
                  <section key={pr.id} className="mb-3" aria-label={pr.name}>
                    <h2 className="m-0 flex h-8 items-center gap-2 px-2 text-[13px] font-medium text-muted-foreground">
                      <span aria-hidden>{pr.icon}</span>
                      <button type="button" className="rounded-sm hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => p.onProject(pr.id)}>
                        {pr.name}
                      </button>
                      <span>{pr.docCount}</span>
                    </h2>
                    {list(rows, pr.name)}
                  </section>
                );
              })}
              {(() => {
                const rows = flattenRows(filterDocs(data.unfiled, query), collapsed);
                return rows.length > 0 && (
                  <section aria-label="미분류">
                    <h2 className="m-0 flex h-8 items-center px-2 text-[13px] font-medium text-muted-foreground">미분류</h2>
                    {list(rows, '미분류')}
                  </section>
                );
              })()}
              {docs.every((d) => !matchesQuery(d.doc.title, query)) && query.trim() && <Empty>맞는 파일이 없어요</Empty>}
            </TabsContent>
            <TabsContent value="recent">
              {shownRecent.length === 0 ? (
                <Empty>{query.trim() ? '맞는 파일이 없어요' : '아직 연 파일이 없어요'}</Empty>
              ) : (
                <ul className="m-0 list-none p-0" aria-label="최근">
                  {shownRecent.map((r) => (
                    <li key={r.path} style={{ height: ROW_HEIGHT }} className="flex items-center rounded-md px-2 text-sm hover:bg-accent/60" data-doc-row={r.path}>
                      <button type="button" onClick={() => p.onOpen(r.path)} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{r.title}</span>
                        {(r.project || r.parent) && <span className="truncate text-[13px] text-muted-foreground">{[r.project, r.parent].filter(Boolean).join(' / ')}</span>}
                      </button>
                      <span className="w-20 shrink-0 text-right text-[13px] text-muted-foreground">{relativeTime(r.modifiedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="projects">
              {data.projects.length === 0 ? (
                <Empty>아직 프로젝트가 없어요. 작업 공간에 폴더를 만들면 프로젝트가 돼요.</Empty>
              ) : (
                <ul className="m-0 list-none p-0" aria-label="프로젝트">
                  {data.projects
                    .filter((pr) => matchesQuery(pr.name, query))
                    .map((pr) => (
                      <li key={pr.id} style={{ height: ROW_HEIGHT }} className="flex items-center rounded-md px-2 text-sm hover:bg-accent/60">
                        <button type="button" onClick={() => p.onProject(pr.id)} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                          <span aria-hidden className="w-4 text-center">{pr.icon}</span>
                          <span className="truncate">{pr.name}</span>
                          <span className="text-[13px] text-muted-foreground">문서 {pr.docCount}개</span>
                        </button>
                        <span className="w-20 shrink-0 text-right text-[13px] text-muted-foreground">{relativeTime(pr.modifiedAt)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="unfiled">
              {(() => {
                const rows = flattenRows(filterDocs(data.unfiled, query), collapsed);
                return rows.length === 0 ? <Empty>{query.trim() ? '맞는 파일이 없어요' : '미분류 파일이 없어요. 모든 파일이 프로젝트 안에 있어요.'}</Empty> : list(rows, '미분류');
              })()}
            </TabsContent>
          </>
        )}
      </div>
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
      <header className="flex min-h-[44px] flex-wrap items-center gap-3 border-b px-4 py-1.5">
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
        <SearchBox value={query} onChange={onQuery} inputRef={search} placeholder="이 프로젝트에서 찾기 ( / )" />
        <Button size="sm" onClick={() => p.onCreate('doc', project.id)}>
          <Plus /> 새 문서
        </Button>
      </header>
      <div className="px-3 py-3">
        <TabsContent value="docs">
          {project.docs.length === 0 ? (
            <Empty>
              <FilePlus2 className="mx-auto mb-2 size-5" aria-hidden />
              이 프로젝트에는 아직 문서가 없어요. 새 문서를 만들어 보세요.
            </Empty>
          ) : rows.length === 0 ? (
            <Empty>맞는 문서가 없어요</Empty>
          ) : (
            <DocList rows={rows} label={`${project.name} 문서`} onOpen={p.onOpen} onToggle={toggle} onDelete={p.onDelete} />
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

