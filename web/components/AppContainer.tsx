import type { ReactNode } from "react";

/** Centered, width-limited column for the app (tool) pages; the landing page is full-bleed. */
export function AppContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-8">{children}</div>;
}
