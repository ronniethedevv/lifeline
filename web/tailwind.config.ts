import type { Config } from "tailwindcss";

/** Colours map to the CSS-variable tokens in app/globals.css (docs/ui_context.md). */
const token = (name: string) => `rgb(from var(--${name}) r g b / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        "bg-subtle": token("bg-subtle"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        "surface-dark": token("surface-dark"),
        border: token("border"),
        "border-strong": token("border-strong"),
        text: token("text"),
        "text-muted": token("text-muted"),
        accent: token("accent"),
        safe: token("safe"),
        watch: token("watch"),
        danger: token("danger"),
        lien: token("lien"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        elevated: "0 16px 36px -12px rgba(15, 17, 21, 0.07)",
      },
    },
  },
  plugins: [],
};
export default config;
