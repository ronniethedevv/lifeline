import Link from "next/link";
import { DotMatrix } from "@/components/ui/dot-matrix";
import { ArrowUpRight } from "@/components/ui/icons";

type FooterLink = { label: string; href: string };

function FooterCol({ title, links, external = false }: { title: string; links: FooterLink[]; external?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">{title}</span>
      {links.map((l) =>
        external ? (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex w-fit items-center gap-1 text-sm text-text transition-colors hover:text-accent"
          >
            {l.label}
            <ArrowUpRight className="h-3 w-3 text-text-muted transition-colors group-hover:text-accent" />
          </a>
        ) : (
          <Link key={l.label} href={l.href} className="w-fit text-sm text-text transition-colors hover:text-accent">
            {l.label}
          </Link>
        ),
      )}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-bg-subtle">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-4 sm:col-span-1">
            <Link href="/" className="flex w-fit items-center gap-2.5 text-lg font-medium tracking-[-0.02em]">
              <DotMatrix size={3} highlight={4} />
              <span>
                Life<span className="text-accent">line</span>
              </span>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-text-muted">
              A rescue market for MUSD loans on Mezo. Providers backstop at-risk loans before liquidation.
            </p>
          </div>
          <FooterCol
            title="App"
            links={[
              { label: "My vaults", href: "/vaults" },
              { label: "Provide", href: "/provide" },
              { label: "Pricer", href: "/pricer" },
            ]}
          />
          <FooterCol
            title="Mezo"
            external
            links={[
              { label: "Website", href: "https://mezo.org" },
              { label: "Developer docs", href: "https://mezo.org/docs/developers/" },
              { label: "Testnet dApp", href: "https://testnet.mezo.org" },
            ]}
          />
          <FooterCol
            title="Network"
            external
            links={[
              { label: "Explorer", href: "https://explorer.test.mezo.org" },
              { label: "Faucet", href: "https://faucet.test.mezo.org" },
              { label: "Source code", href: "https://github.com/ronniethedevv/lifeline" },
              { label: "How to try it", href: "https://github.com/ronniethedevv/lifeline#try-it" },
            ]}
          />
        </div>
        <div className="hairline mt-12 flex flex-col gap-2 pt-6 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Lifeline. Built for the Mezo Buildathon.</span>
          <span>Testnet only. Immutable contracts. Not financial advice.</span>
        </div>
      </div>
    </footer>
  );
}
