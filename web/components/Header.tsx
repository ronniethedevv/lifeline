"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <nav className="flex items-center gap-5">
          <Link href="/" className="text-lg font-semibold">
            Life<span className="text-accent">line</span>
          </Link>
          <Link href="/vaults" className="text-sm text-text-muted hover:text-text">
            My vaults
          </Link>
          <Link href="/provide" className="text-sm text-text-muted hover:text-text">
            Provide
          </Link>
        </nav>
        <ConnectButton chainStatus="icon" showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "full" }} />
      </div>
    </header>
  );
}
