"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowPill } from "@/components/ui/arrow-pill";
import { ArrowRight, Close, Menu } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/vaults", label: "My vaults", hint: "Open a loan, set rescue terms" },
  { href: "/provide", label: "Provide", hint: "Back loans, earn rescue fees" },
  { href: "/pricer", label: "Pricer", hint: "How a rescue fee is priced" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on navigation and on Escape.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <nav className="flex items-center gap-6" aria-label="Main">
          <Link href="/" className="text-lg font-medium tracking-[-0.02em]">
            Life<span className="text-accent">line</span>
          </Link>
          <div className="hidden items-center gap-5 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={cn(
                  "text-sm transition-colors hover:text-text",
                  isActive(pathname, n.href) ? "font-medium text-text" : "text-text-muted",
                )}
              >
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="flex items-center gap-2">
          <ConnectPill />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-text transition-colors hover:bg-surface-2 sm:hidden"
          >
            {open ? <Close /> : <Menu />}
          </button>
        </div>
      </div>

      {/* Mobile navigation panel: below the bar, full width, large tap targets. */}
      <div
        id="mobile-nav"
        hidden={!open}
        className="border-t border-border bg-white/95 backdrop-blur-md sm:hidden"
      >
        <nav aria-label="Mobile" className="mx-auto flex max-w-6xl flex-col px-4 py-2">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="group flex min-h-[56px] items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
              >
                <span className="flex flex-col">
                  <span className={cn("text-base", active ? "font-medium text-accent" : "text-text")}>{n.label}</span>
                  <span className="text-xs text-text-muted">{n.hint}</span>
                </span>
                <ArrowRight className="text-text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </nav>
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
