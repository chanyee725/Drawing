// Small chips on a page tab for agents working on that page while another page is shown.
import { roleColor, type Agent } from './model';

const MAX = 2;

export function PageAgentChips({ agents }: { agents: Agent[] | undefined }) {
  if (!agents?.length) return null;
  const names = agents.map((a) => a.name || '이름 없음').join(', ');
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle" title={`${names} 님이 이 페이지에서 일하고 있어요`} data-testid="page-chips">
      {agents.slice(0, MAX).map((a) => (
        <span
          key={a.id}
          className="max-w-[80px] truncate rounded-full px-1.5 py-px text-[10px] font-medium leading-4 text-white"
          style={{ background: roleColor(a.role, a.roleName) }}
          data-chip={a.id}
        >
          {a.name || '?'}
        </span>
      ))}
      {agents.length > MAX && <span className="rounded-full bg-neutral-200 px-1.5 py-px text-[10px] leading-4 text-neutral-700">+{agents.length - MAX}</span>}
    </span>
  );
}
