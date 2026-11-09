"use client";

import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StatusStrip } from "@/components/StatusStrip";
import { Providers } from "./providers";

/** The interactive app shell (wallet providers + chrome). Rendered client-only (see ClientShell). */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <StatusStrip />
        <Header />
        <main className="flex flex-1 flex-col">{children}</main>
        <Footer />
      </div>
    </Providers>
  );
}
