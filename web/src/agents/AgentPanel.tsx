// Right-hand list of agents: status, activity, file/page and time since the last change.
// Clicking an agent with a change jumps to its page and cursor.
import { useNow } from './useLiveAgents';
import { roleColor, statusInfo, timeAgo, type Agent, type DispatchInfo } from './model';

const TONE_DOT = { live: 'bg-green-500', wait: 'bg-amber-500', off: 'bg-neutral-300' } as const;

export interface AgentPanelProps {
  agents: Agent[];
  dispatch: DispatchInfo;
  loaded: boolean;
  onPick(agent: Agent): void;
  /** "활동 내용 보기": off by default, since the line comes from the agent's conversation. */
  showActivity: boolean;
  onShowActivity(on: boolean): void;
}

const baseName = (p: string) => p.split('/').pop() || p;

// Stable order (working first, then by name) so rows don't jump under the pointer on each edit.
const TONE_RANK = { live: 0, wait: 1, off: 2 } as const;
function order(a: Agent, b: Agent) {
  const d = TONE_RANK[statusInfo(a.status).tone] - TONE_RANK[statusInfo(b.status).tone];
  return d || a.name.localeCompare(b.name);
}

export function AgentPanel({ agents, dispatch, loaded, onPick, showActivity, onShowActivity }: AgentPanelProps) {
  const now = useNow(1000);
  const list = [...agents].sort(order);
  const note = !loaded
    ? '에이전트 정보를 불러오고 있어요.'
    : !dispatch.found
      ? 'Dispatch를 찾지 못했어요. --dispatch로 주소를 알려 주세요.'
      : !dispatch.connected
        ? 'Dispatch에 연결하고 있어요.'
        : !list.length
          ? '지금 일하는 에이전트가 없어요.'
          : null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-neutral-200 bg-white" aria-label="에이전트" data-testid="agent-panel">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-sm font-semibold">에이전트</span>
        {list.length > 0 && <span className="text-xs text-neutral-500">{list.length}명</span>}
      </div>
      <label className="flex cursor-pointer items-start gap-2 border-b border-neutral-200 px-3 py-2" data-testid="activity-toggle">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={showActivity}
          onChange={(e) => onShowActivity(e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-xs font-medium text-neutral-700">활동 내용 보기</span>
          <span className="text-[11px] text-neutral-500">켜면 대화에서 나온 한 줄이 화면에 보여요.</span>
        </span>
      </label>
      {note && <p className="px-3 py-3 text-sm text-neutral-500">{note}</p>}
      <ul className="flex-1 overflow-y-auto">
        {list.map((a) => {
          const st = statusInfo(a.status);
          const c = a.lastChange;
          const where = c?.relPath
            ? `${baseName(c.relPath)}${c.page?.name ? ` › ${c.page.name}` : ''}${c.source && c.source !== 'main' ? ` (${c.source})` : ''}`
            : null;
          const ago = timeAgo(c?.at ?? null, now);
          return (
            <li key={a.id} className="border-b border-neutral-100">
              <button
                type="button"
                className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-neutral-50 disabled:cursor-default disabled:hover:bg-transparent"
                onClick={() => onPick(a)}
                disabled={!c?.page}
                title={c?.page ? '이 에이전트가 일하는 곳으로 가요' : '아직 바꾼 다이어그램이 없어요'}
                data-agent={a.id}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[st.tone]}`} title={st.label} aria-label={st.label} />
                  <span className="truncate text-sm font-medium">{a.name || '이름 없음'}</span>
                  {a.roleName && (
                    <span
                      className="shrink-0 rounded px-1.5 py-px text-[11px] font-medium text-white"
                      style={{ background: roleColor(a.role, a.roleName) }}
                    >
                      {a.roleName}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{st.label}</span>
                </span>
                {showActivity && a.activity && <span className="line-clamp-2 text-xs text-neutral-600" data-testid="activity-line">{a.activity}</span>}
                <span className="flex items-center gap-2 text-[11px] text-neutral-500">
                  <span className="truncate">{where ?? '아직 바꾼 다이어그램이 없어요'}</span>
                  {ago && <span className="ml-auto shrink-0 tabular-nums">{ago}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
