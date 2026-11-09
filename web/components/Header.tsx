"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { ArrowPill } from "@/components/ui/arrow-pill";

const NAV = [
  { href: "/vaults", label: "My vaults" },
  { href: "/provide", label: "Provide" },
  { href: "/pricer", label: "Pricer" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <nav className="flex items-center gap-6">
          <Link href="/" className="text-lg font-medium tracking-[-0.02em]">
            Life<span className="text-accent">line</span>
          </Link>
          <div className="hidden items-center gap-5 sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm text-text-muted transition-colors hover:text-text">
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
        <ConnectPill />
      </div>
    </header>
  );
}

/** Nav connect trigger as a dark pill with a white circular arrow badge (RainbowKit modal under it). */
function ConnectPill() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        let content;
        if (!mounted || account === undefined || chain === undefined) {
          content = (
            <ArrowPill variant="secondary" onClick={openConnectModal}>
              Connect
            </ArrowPill>
          );
        } else if (chain.unsupported === true) {
          content = (
            <ArrowPill variant="secondary" onClick={openChainModal}>
              Wrong network
            </ArrowPill>
          );
        } else {
          content = (
            <button
              type="button"
              onClick={openAccountModal}
              className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-white px-3.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-2"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-safe" aria-hidden />
              <span className="font-mono tabular-nums">{account.displayName}</span>
            </button>
          );
        }
        return (
          <div aria-hidden={!mounted} className={mounted ? "" : "pointer-events-none select-none opacity-0"}>
            {content}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
