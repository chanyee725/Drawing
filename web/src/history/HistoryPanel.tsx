// Timeline panel (newest first), replay scrubber and the "past version" banner.
// Render inside the diagram's positioned container; it floats on the left.
import { useMemo } from 'react';
import type { HistoryState } from './useHistory';
import { formatTime, timeline, whoLabel, type Version } from './timeline';

const btn = 'h-7 min-w-7 rounded-md px-1.5 text-sm text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40';

export function HistoryPanel({ h }: { h: HistoryState }) {
  const items = useMemo(() => timeline(h.versions, h.commits), [h.versions, h.commits]);
  const selected = h.selection;
  const selVersion = selected?.kind === 'version' ? h.versions.find((v) => v.seq === selected.seq) : undefined;
  const selCommit = selected?.kind === 'git' ? h.commits.find((c) => c.sha === selected.sha) : undefined;

  if (!h.open) {
    return (
      <button
        type="button"
        onClick={h.toggleOpen}
        className="absolute left-3 top-3 z-10 h-8 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-700 shadow-sm hover:bg-neutral-50"
        data-testid="history-toggle"
      >
        변경 기록
      </button>
    );
  }

  return (
    <>
      <aside
        className="absolute bottom-3 left-3 top-3 z-10 flex w-80 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow"
        aria-label="변경 기록"
        data-testid="history-panel"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
          <span className="text-sm font-medium">변경 기록</span>
          <button type="button" className={btn} onClick={h.toggleOpen} data-testid="history-toggle">
            닫기
          </button>
        </div>

        {!h.enabled ? (
          <p className="p-3 text-sm text-neutral-500">예시 데이터에는 변경 기록이 없어요.</p>
        ) : (
          <>
            <Scrubber h={h} />
            {h.loadError && <p className="px-3 py-2 text-sm text-red-600">{h.loadError}</p>}
            <ol className="flex-1 overflow-y-auto" data-testid="history-list">
              {items.length === 0 && !h.loadError && (
                <li className="p-3 text-sm text-neutral-500">아직 기록이 없어요. 파일이 바뀌면 여기에 쌓여요.</li>
              )}
              {items.map((it) =>
                it.type === 'version' ? (
                  <li key={`v${it.version.seq}`}>
                    <VersionItem v={it.version} active={selVersion?.seq === it.version.seq} onClick={() => (h.pause(), h.selectVersion(it.version))} />
                  </li>
                ) : (
                  <li key={`g${it.commit.sha}`}>
                    <button
                      type="button"
                      onClick={() => h.selectCommit(it.commit)}
                      className={`block w-full border-b border-neutral-100 px-3 py-2 text-left hover:bg-neutral-50 ${selCommit?.sha === it.commit.sha ? 'bg-blue-50' : ''}`}
                      data-testid="history-item"
                      data-sha={it.commit.sha}
                    >
                      <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <span className="tabular-nums">{formatTime(it.at)}</span>
                        <span className="rounded bg-neutral-100 px-1 font-mono text-neutral-600">커밋 {it.commit.sha.slice(0, 7)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-neutral-800" title={it.commit.subject}>
                        {it.commit.subject}
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ol>
            {!h.gitAvailable && h.versions.length > 0 && (
              <p className="border-t border-neutral-100 px-3 py-1.5 text-xs text-neutral-400">git 저장소가 아니어서 커밋 기록은 없어요.</p>
            )}
          </>
        )}
      </aside>

      {selected && (
        <div
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white shadow"
          role="status"
          data-testid="history-banner"
          data-version={selected.kind === 'version' ? `v:${selected.seq}` : `g:${selected.sha}`}
          data-shown={h.view?.key ?? ''}
        >
          <span>
            {h.viewError ??
              (h.view?.missingPage
                ? '이 버전에는 이 페이지가 없어요.'
                : selVersion
                  ? `${formatTime(selVersion.at)} · ${whoLabel(selVersion)} 버전을 보고 있어요`
                  : selCommit
                    ? `커밋 ${selCommit.sha.slice(0, 7)} 버전을 보고 있어요`
                    : '지난 버전을 보고 있어요')}
          </span>
          <button type="button" className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25" onClick={h.exit}>
            지금으로
          </button>
        </div>
      )}
    </>
  );
}

function VersionItem({ v, active, onClick }: { v: Version; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!v.snapshot}
      title={v.snapshot ? undefined : '오래돼서 내용은 지워졌어요'}
      className={`block w-full border-b border-neutral-100 px-3 py-2 text-left hover:bg-neutral-50 disabled:cursor-default disabled:opacity-50 ${active ? 'bg-blue-50' : ''}`}
      aria-current={active ? 'true' : undefined}
      data-testid="history-item"
      data-seq={v.seq}
    >
      <span className="flex items-center gap-1.5 text-xs text-neutral-500">
        <span className="tabular-nums">{formatTime(v.at)}</span>
        <span className={`truncate rounded px-1 ${v.source.kind === 'main' ? 'bg-neutral-100 text-neutral-600' : 'bg-violet-100 text-violet-700'}`}>
          {whoLabel(v)}
        </span>
      </span>
      <span className="mt-0.5 flex gap-1.5 text-sm">
        <span className="shrink-0 text-neutral-500">{v.page.name}</span>
        <span className="truncate text-neutral-800">{v.summary || '변경'}</span>
      </span>
    </button>
  );
}

function Scrubber({ h }: { h: HistoryState }) {
  const n = h.steps.length;
  return (
    <div className="border-b border-neutral-200 px-3 py-2" data-testid="scrubber">
      <div className="flex items-center gap-1">
        <button type="button" className={btn} onClick={() => (h.pause(), h.step(-1))} disabled={!n || h.index === 0} data-testid="scrub-prev">
          이전
        </button>
        <button
          type="button"
          className={`${btn} w-16`}
          onClick={h.playing ? h.pause : h.play}
          disabled={!n}
          data-testid="scrub-play"
        >
          {h.playing ? '멈춤' : '재생'}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => (h.pause(), h.step(1))}
          disabled={!n || h.index === n - 1}
          data-testid="scrub-next"
        >
          다음
        </button>
        <span className="ml-auto text-xs tabular-nums text-neutral-500" data-testid="scrub-pos">
          {h.index >= 0 ? `${h.index + 1} / ${n}` : n ? `지금 · ${n}개` : '기록 없음'}
        </span>
      </div>
      <input
        type="range"
        className="mt-1 w-full accent-neutral-800"
        min={0}
        max={Math.max(0, n - 1)}
        value={h.index >= 0 ? h.index : Math.max(0, n - 1)}
        onChange={(e) => (h.pause(), h.seek(Number(e.target.value)))}
        disabled={n < 1}
        aria-label="변경 재생 위치"
        data-testid="scrub-range"
      />
    </div>
  );
}
