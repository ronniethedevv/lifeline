import { ArrowUpRight } from "@/components/ui/icons";
import { MEZO_TESTNET_CHAIN_ID } from "@/lib/wallet";

/** Slim protocol-status bar above the nav: network, chain and a link to the explorer. */
export function StatusStrip() {
  return (
    <div className="bg-accent text-white">
      <div className="mx-auto flex h-7 max-w-6xl items-center justify-between gap-4 px-6 text-xs">
        <span className="flex items-center gap-2 font-medium">
          <span className="relative flex h-1.5 w-1.5">
            <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-white" />
          </span>
          Mezo Testnet
          <span className="font-normal text-white/75">Chain {MEZO_TESTNET_CHAIN_ID}</span>
        </span>
        <span className="flex items-center gap-4 text-white/85">
          <span className="hidden sm:inline">Testnet funds only</span>
          <a
            href="https://explorer.test.mezo.org"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-white transition-opacity hover:opacity-80"
          >
            Explorer
            <ArrowUpRight className="h-3 w-3" />
          </a>
        </span>
      </div>
    </div>
  );
}
