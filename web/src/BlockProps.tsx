// Property pickers for a diagram block: each one edits a global style line in the code.
import { defaultFor, propsFor, readGlobal, writeGlobal } from './dsl/globals';

type Props = { type: string; code: string; onChange: (code: string) => void };

export function BlockProps({ type, code, onChange }: Props) {
  const defs = propsFor(type);
  if (defs.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="group" aria-label="다이어그램 속성" data-block-props="">
      {defs.map((def) => {
        const fallback = defaultFor(def, type);
        const current = readGlobal(code, def.key);
        const known = current === null || def.options.some((o) => o.value === current);
        return (
          <label key={def.key} className="flex items-center gap-1">
            <span style={{ color: 'var(--text-muted)' }}>{def.label}</span>
            <select
              data-prop={def.key}
              value={current ?? ''}
              onChange={(e) => onChange(writeGlobal(code, def.key, e.target.value || null))}
              className="h-7 rounded-md border px-1"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <option value="">{`기본 (${def.options.find((o) => o.value === fallback)?.label ?? fallback})`}</option>
              {!known && <option value={current!}>{current}</option>}
              {def.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
