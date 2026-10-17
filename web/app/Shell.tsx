"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Providers } from "./providers";

/** The interactive app shell (wallet providers + chrome). Rendered client-only (see ClientShell). */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Header />
      <main className="flex flex-col">{children}</main>
    </Providers>
  );
}
