import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "devomni.theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
};

const resolve = (pref: ThemePref): Theme => (pref === "system" ? (media?.matches ? "dark" : "light") : pref);

/** Applies the theme to <html> (CSS variables in styles.css key off data-theme). */
const apply = (theme: Theme) => {
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.style.colorScheme = theme;
};

interface ThemeState {
  pref: ThemePref;
  theme: Theme;
  setPref: (pref: ThemePref) => void;
  /** system → light → dark → system */
  cycle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const pref = readPref();
  const theme = resolve(pref);
  apply(theme);

  media?.addEventListener("change", () => {
    if (get().pref !== "system") return;
    const next = resolve("system");
    apply(next);
    set({ theme: next });
  });

  return {
    pref,
    theme,
    setPref: (p) => {
      try {
        localStorage.setItem(KEY, p);
      } catch {
        /* preference just won't persist */
      }
      const t = resolve(p);
      apply(t);
      set({ pref: p, theme: t });
    },
    cycle: () => {
      const order: ThemePref[] = ["system", "light", "dark"];
      get().setPref(order[(order.indexOf(get().pref) + 1) % order.length]);
    },
  };
});
