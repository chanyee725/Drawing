// The open file and its saving, outside React. Components subscribe to the slice they draw
// (useSession), so an edit that only moves a block re-renders the canvas and nothing else.
// Saving: edits are debounced, saves run one at a time, retryable failures back off, 409 stops for a choice.
// Outside changes (server SSE events) close or reload the open file through `external`.
import { ApiError, FILE_FORMAT_VERSION, type DpxFile } from './api.ts';
import { externalAction, type WorkspaceEvent } from './externalChange.ts';
import { isRetryableSaveError, RELOAD_STOPPED, saveProblemText } from './saveRetry.ts';
import { migrateDocument } from './doc/model.ts';

export const SAVE_DELAY = 700;
export const RETRY_MIN = 1000;
export const RETRY_MAX = 30000;

export type FilePatch = Partial<Pick<DpxFile, 'title' | 'document' | 'blocks' | 'canvas'>>;
export type SessionState = {
  path: string | null;
  file: DpxFile | null;
  /** Bumped on every load from disk so the panes restart from the loaded content. */
  loadSeq: number;
  status: string;
  /** True while the status is a problem (failed save or conflict). */
  statusAlert: boolean;
  /** Set when a save got 409: the server's current revision, so "overwrite" can re-send against it. */
  conflict: { revision?: number } | null;
};

type Deps = {
  saveFile: (path: string, f: DpxFile, keepalive: boolean) => Promise<{ revision: number }>;
  /** After each successful save (the file list shows the new title/revision). */
  onSaved?: () => void;
};

export type FileSession = ReturnType<typeof createFileSession>;

export function createFileSession(deps: Deps) {
  let state: SessionState = { path: null, file: null, loadSeq: 0, status: '', statusAlert: false, conflict: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SessionState>) => {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof SessionState)[]) if (!Object.is(state[k], patch[k])) changed = true;
    if (!changed) return;
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  // dirty: local edits not yet on disk. editSeq tells a finished save whether newer edits arrived meanwhile.
  let dirty = false;
  let editSeq = 0;
  let inFlight = false;
  let retryDelay = 0;
  let conflicted = false;
  // Set when a reload was stopped because the save failed: that notice stays until a save succeeds.
  let reloadStopped = false;
  // An outside-change reload is already running.
  let reloading = false;

  const setStatus = (status: string, statusAlert = false) => set({ status, statusAlert });
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, ms);
  };

  function save(keepalive = false) {
    // Saves run one at a time so each PUT carries the revision returned by the previous one.
    saving = saving.then(async () => {
      const p = state.path;
      const f = state.file;
      if (!p || !f || !dirty || conflicted) return;
      const seq = editSeq;
      inFlight = true;
      if (!reloadStopped) setStatus('저장 중이에요…');
      try {
        const saved = await deps.saveFile(p, f, keepalive);
        if (state.path !== p) return;
        if (state.file) set({ file: { ...state.file, revision: saved.revision } });
        retryDelay = 0;
        if (editSeq === seq) {
          dirty = false;
          reloadStopped = false;
          setStatus('저장했어요');
        }
        deps.onSaved?.();
      } catch (e) {
        if (state.path !== p) return;
        // A retry or refusal must not hide the notice that the reload was stopped.
        const problem = (text: string) => setStatus(saveProblemText(text, reloadStopped), true);
        if (e instanceof ApiError && e.status === 409) {
          clearTimer();
          conflicted = true;
          set({ conflict: { revision: e.revision } });
          problem('다른 곳에서 바뀌었어요');
        } else if (!isRetryableSaveError(e)) {
          // The server refused this request (4xx); retrying the same body would fail forever.
          // Keep a pending edit timer: a newer edit may already have fixed the body.
          const newer = e instanceof ApiError && e.status === 422 && (state.file?.version ?? 1) > FILE_FORMAT_VERSION;
          problem(newer ? '더 새 버전에서 만든 파일이라 저장하지 않았어요' : '저장하지 못했어요. 내용이나 파일 이름을 확인해 주세요');
        } else {
          retryDelay = Math.min(RETRY_MAX, Math.max(RETRY_MIN, retryDelay * 2));
          problem('저장하지 못했어요. 잠시 뒤 다시 시도할게요');
          // A pending edit timer will save sooner; otherwise back off and retry.
          if (timer === null) schedule(retryDelay);
        }
      } finally {
        inFlight = false;
      }
    });
    return saving;
  }

  // The open file is gone (deleted or moved away): drop it and its pending save, or the timer would write to a path that no longer exists.
  const close = () => {
    clearTimer();
    dirty = false;
    conflicted = false;
    reloadStopped = false;
    set({ conflict: null, path: null, file: null, status: '', statusAlert: false });
  };

  const flush = async () => {
    clearTimer();
    await save();
  };

  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setStatus,
    /** Local edits not on disk yet. */
    isDirty: () => dirty,
    /** Leaving now would lose something: unsaved edits or a save still running. */
    hasUnsaved: () => dirty || inFlight,
    /** Resolves once queued saves are done. */
    idle: () => saving,
    save,
    flush,
    /** Save before a lazy-chunk reload. False (and a notice) when edits are still unsaved or in conflict. */
    async flushForReload() {
      await flush();
      if (!dirty && !conflicted) return true;
      reloadStopped = true;
      setStatus(RELOAD_STOPPED, true);
      return false;
    },
    edit(patch: FilePatch) {
      if (!state.file) return;
      set({ file: { ...state.file, ...patch } });
      dirty = true;
      editSeq += 1;
      if (!conflicted && !reloadStopped) setStatus('');
      schedule(SAVE_DELAY);
    },
    load(p: string, f: DpxFile) {
      clearTimer();
      dirty = false;
      retryDelay = 0;
      conflicted = false;
      reloadStopped = false;
      // A file from before the document editor gets its diagrams listed in the document (once: saves store version 2).
      set({ conflict: null, path: p, file: { ...f, document: migrateDocument(f) }, loadSeq: state.loadSeq + 1, status: '', statusAlert: false });
    },
    close,
    /**
     * A server `workspace` event (other tabs, outside edits). 'close': the open file was deleted or moved
     * away and has been dropped. 'reload': it changed on disk with nothing unsaved, so once queued saves are
     * done it is re-read and handed to `onReload` if still clean and newer. The caller refreshes the file list.
     */
    external(e: WorkspaceEvent, read: (p: string) => Promise<DpxFile>, onReload: (p: string, f: DpxFile) => void) {
      const act = externalAction(e, state.path, dirty || inFlight);
      if (act === 'close') close();
      else if (act === 'reload' && !reloading) {
        const p = state.path!;
        reloading = true;
        void saving
          .then(() => (dirty || state.path !== p ? null : read(p)))
          .then((f) => {
            if (f && !dirty && state.path === p && f.revision > (state.file?.revision ?? 0)) onReload(p, f);
          })
          .catch(() => {})
          .finally(() => {
            reloading = false;
          });
      }
      return act;
    },
    /** 409 choice: re-send local edits against the server's revision. */
    async overwrite() {
      await saving;
      const f = state.file;
      const rev = state.conflict?.revision;
      if (!f || rev === undefined) return;
      conflicted = false;
      set({ file: { ...f, revision: rev }, conflict: null });
      dirty = true;
      clearTimer();
      await save();
    },
    /** On pagehide: send pending edits with keepalive. */
    saveOnHide() {
      // Skip when a PUT is already running: it holds the same revision, so a second one would only 409.
      if (!dirty || inFlight || conflicted) return;
      clearTimer();
      void save(true);
    },
  };
}
