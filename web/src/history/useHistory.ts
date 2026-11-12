// State for the history panel: the file's recorded versions and commits, which
// one is shown instead of the live page, and scrubber replay.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { historyApi, type VersionView } from './api';
import { playable, stepIndex, type Commit, type HighlightCell, type Version } from './timeline';

export type Selection = { kind: 'version'; seq: number } | { kind: 'git'; sha: string } | null;

/** What the diagram shows while a past version is selected. */
export interface HistoryView {
  /** Unique per shown version; use as the diagram's flash key so live flashes stay off. */
  key: string;
  xml: string;
  cells: HighlightCell[];
  /** True when this version has no page with the current page id. */
  missingPage: boolean;
}

export const STEP_MS = 1100;
const EMPTY = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

export interface UseHistoryArgs {
  /** False for the mock data source (no history endpoints). */
  enabled: boolean;
  fileId: string | null;
  pageId: string | null;
  setPageId: (id: string) => void;
}

export function useHistory({ enabled, fileId, pageId, setPageId }: UseHistoryArgs) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<HistoryView | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const cache = useRef(new Map<string, Promise<VersionView>>());

  const steps = useMemo(() => playable(versions), [versions]);
  const index = selection?.kind === 'version' ? steps.findIndex((v) => v.seq === selection.seq) : -1;

  // A different file: start over.
  useEffect(() => {
    setSelection(null);
    setView(null);
    setPlaying(false);
    setVersions([]);
    setCommits([]);
    setLoadError(null);
    cache.current.clear();
  }, [fileId]);

  // Load the list while the panel is open; refresh on live changes to this file.
  useEffect(() => {
    if (!open || !enabled || !fileId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loadVersions = () =>
      historyApi
        .versions(fileId)
        .then((v) => alive && (setVersions(v), setLoadError(null)))
        .catch(() => alive && setLoadError('변경 기록을 불러오지 못했어요.'));
    loadVersions();
    historyApi
      .gitLog(fileId)
      .then((g) => alive && (setCommits(g.commits), setGitAvailable(g.available)))
      .catch(() => alive && setGitAvailable(false));
    const off = historyApi.watch((id) => {
      if (id !== fileId || timer) return;
      timer = setTimeout(() => {
        timer = null;
        loadVersions();
      }, 150);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [open, enabled, fileId]);

  const fetchView = useCallback(
    (sel: NonNullable<Selection>, page: string | null): Promise<VersionView> => {
      const key = sel.kind === 'version' ? `v:${sel.seq}` : `g:${sel.sha}:${page ?? ''}`;
      let p = cache.current.get(key);
      if (!p) {
        p = sel.kind === 'version' ? historyApi.version(fileId!, sel.seq) : historyApi.gitVersion(fileId!, sel.sha, page);
        p.catch(() => cache.current.delete(key));
        cache.current.set(key, p);
        if (cache.current.size > 64) cache.current.delete(cache.current.keys().next().value!);
      }
      return p;
    },
    [fileId],
  );

  // Fetch what the selection shows. Keep the previous view until the new one arrives.
  const viewPage = selection?.kind === 'git' ? pageId : null;
  useEffect(() => {
    if (!selection || !fileId) {
      setView(null);
      setViewError(null);
      return;
    }
    let alive = true;
    const key = selection.kind === 'version' ? `v:${selection.seq}` : `g:${selection.sha}:${viewPage ?? ''}`;
    fetchView(selection, viewPage)
      .then((v) => {
        if (!alive) return;
        setViewError(null);
        setView({ key, xml: v.xml ?? EMPTY, cells: v.xml ? v.cells : [], missingPage: v.xml == null });
      })
      .catch(() => {
        if (!alive) return;
        setPlaying(false);
        setViewError('이 버전을 불러오지 못했어요.');
      });
    return () => {
      alive = false;
    };
  }, [selection, viewPage, fileId, fetchView]);

  // A recorded version is one page: picking another page tab goes back to live.
  const lastPage = useRef(pageId);
  useEffect(() => {
    const prev = lastPage.current;
    lastPage.current = pageId;
    if (prev === pageId || selection?.kind !== 'version') return;
    const v = versions.find((x) => x.seq === selection.seq);
    if (v && v.page.id !== pageId) {
      setSelection(null);
      setPlaying(false);
    }
  }, [pageId, selection, versions]);

  const selectVersion = useCallback(
    (v: Version) => {
      if (!v.snapshot) return;
      setSelection({ kind: 'version', seq: v.seq });
      if (v.page.id && v.page.id !== pageId) setPageId(v.page.id);
    },
    [pageId, setPageId],
  );

  const selectCommit = useCallback((c: Commit) => {
    setPlaying(false);
    setSelection({ kind: 'git', sha: c.sha });
  }, []);

  const exit = useCallback(() => {
    setPlaying(false);
    setSelection(null);
  }, []);

  const seek = useCallback((i: number) => steps[i] && selectVersion(steps[i]), [steps, selectVersion]);
  const step = useCallback((delta: number) => seek(stepIndex(index, delta, steps.length)), [index, steps.length, seek]);

  const play = useCallback(() => {
    if (!steps.length) return;
    // From live or the last step, start over from the first change.
    if (index < 0 || index >= steps.length - 1) seek(0);
    setPlaying(true);
  }, [steps.length, index, seek]);

  // Replay: advance one step after the current one has been shown for STEP_MS.
  const shownKey = view?.key;
  useEffect(() => {
    if (!playing) return;
    const cur = steps[index];
    if (!cur || shownKey !== `v:${cur.seq}`) return; // wait until this step is on screen
    if (index >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const next = steps[index + 1];
    fetchView({ kind: 'version', seq: next.seq }, null).catch(() => {}); // prefetch
    const t = setTimeout(() => seek(index + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, steps, shownKey, seek, fetchView]);

  const toggleOpen = useCallback(() => {
    if (open) {
      setPlaying(false);
      setSelection(null);
    }
    setOpen(!open);
  }, [open]);

  return {
    enabled,
    open,
    toggleOpen,
    versions,
    commits,
    gitAvailable,
    loadError,
    selection,
    /** Shown instead of the live page while a version is selected (null = live). */
    view: selection ? view : null,
    viewError,
    selectVersion,
    selectCommit,
    exit,
    steps,
    index,
    step,
    seek,
    playing,
    play,
    pause: () => setPlaying(false),
  };
}

export type HistoryState = ReturnType<typeof useHistory>;
