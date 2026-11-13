import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
/** What the user picked: a fixed theme, or follow the system (stored as no entry). */
export type ThemePref = Theme | 'system';
const KEY = 'drawing.theme';

const systemTheme = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const initialPref = (): ThemePref => {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'light' || s === 'dark') return s;
  } catch {
    /* storage blocked: fall through */
  }
  return 'system';
};

/** [theme in effect, toggle light/dark, preference, set preference]. 'system' follows prefers-color-scheme live. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(initialPref);
  const [system, setSystem] = useState<Theme>(systemTheme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const theme: Theme = pref === 'system' ? system : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* ignore */
    }
  }, [theme, pref]);
  const toggle = () => setPref(theme === 'dark' ? 'light' : 'dark');
  return [theme, toggle, pref, setPref] as const;
}
