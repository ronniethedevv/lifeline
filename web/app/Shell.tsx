"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Providers } from "./providers";

/** The interactive app shell (wallet providers + chrome). Rendered client-only (see ClientShell). */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Header />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">{children}</main>
    </Providers>
  );
}
