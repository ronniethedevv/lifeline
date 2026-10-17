"use client";

import dynamic from "next/dynamic";

// AccountPanel imports Mezo Passport (browser-only), so load it client-side to keep it out of SSR.
const AccountPanel = dynamic(() => import("@/components/AccountPanel").then((m) => m.AccountPanel), { ssr: false });

export default function Home() {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold sm:text-3xl">Don&apos;t get liquidated.</h1>
        <p className="text-text-muted">
          Lifeline rescue providers repay part of your MUSD loan when it nears liquidation, and take a short-term
          claim on its BTC until you repay.
        </p>
      </section>
      <AccountPanel />
    </>
  );
}
