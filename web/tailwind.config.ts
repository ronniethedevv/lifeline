import type { Config } from "tailwindcss";

/** Colours map to the CSS-variable tokens in app/globals.css (docs/ui_context.md). */
const token = (name: string) => `rgb(from var(--${name}) r g b / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        border: token("border"),
        text: token("text"),
        "text-muted": token("text-muted"),
        accent: token("accent"),
        safe: token("safe"),
        watch: token("watch"),
        danger: token("danger"),
        lien: token("lien"),
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};
export default config;
