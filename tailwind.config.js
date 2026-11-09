/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "rgb(var(--surface-0) / <alpha-value>)",
          1: "rgb(var(--surface-1) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
        },
        line: "rgb(var(--line) / <alpha-value>)",
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          faint: "rgb(var(--fg-faint) / <alpha-value>)",
        },
        accent: "rgb(var(--accent) / <alpha-value>)",
        ok: "rgb(var(--ins-bg) / <alpha-value>)",
        warn: "rgb(var(--chg) / <alpha-value>)",
        err: "rgb(var(--del-bg) / <alpha-value>)",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Code"', "Consolas", "ui-monospace", "monospace"],
        sans: ['"Inter"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
