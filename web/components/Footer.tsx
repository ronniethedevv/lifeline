import Link from "next/link";

type FooterLink = { label: string; href: string };

function FooterCol({ title, links, external = false }: { title: string; links: FooterLink[]; external?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-semibold">{title}</span>
      {links.map((l) =>
        external ? (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="text-sm text-text-muted hover:text-text">
            {l.label}
          </a>
        ) : (
          <Link key={l.label} href={l.href} className="text-sm text-text-muted hover:text-text">
            {l.label}
          </Link>
        ),
      )}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <Link href="/" className="text-lg font-semibold">
              Life<span className="text-accent">line</span>
            </Link>
            <p className="max-w-xs text-sm text-text-muted">A rescue market for MUSD loans on Mezo. Testnet only.</p>
          </div>
          <FooterCol title="App" links={[{ label: "My vaults", href: "/vaults" }, { label: "Provide", href: "/provide" }]} />
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
            ]}
          />
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Lifeline · Built for the Mezo Buildathon</span>
          <span>Testnet only. Immutable contracts. Not financial advice.</span>
        </div>
      </div>
    </footer>
  );
}
