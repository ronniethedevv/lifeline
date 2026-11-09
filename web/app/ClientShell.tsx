"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/icons";

// Mezo Passport's wallet libraries touch `document` at import time, so the whole interactive shell
// is client-only. SSR has no value for a wallet dApp; this keeps those modules out of the server bundle.
const Shell = dynamic(() => import("./Shell").then((m) => m.Shell), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-text-muted">
      <Spinner className="h-5 w-5 text-accent" />
      <span>Loading Lifeline</span>
    </div>
  ),
});

export function ClientShell({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
