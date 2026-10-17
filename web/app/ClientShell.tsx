"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Mezo Passport's wallet libraries touch `document` at import time, so the whole interactive shell
// is client-only. SSR has no value for a wallet dApp; this keeps those modules out of the server bundle.
const Shell = dynamic(() => import("./Shell").then((m) => m.Shell), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-text-muted">Loading…</div>,
});

export function ClientShell({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
