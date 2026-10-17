import { Audiences } from "./Audiences";
import { Hero } from "./Hero";
import { Steps } from "./Steps";

export function Landing() {
  return (
    <div className="flex flex-col overflow-x-hidden">
      <Hero />
      <Steps />
      <Audiences />
      <TrustStrip />
    </div>
  );
}

function TrustStrip() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-8 text-sm text-text-muted">
        <span>
          Built on <span className="text-text">Mezo</span>
        </span>
        <Dot />
        <span>
          Rescues <span className="text-text">MUSD</span> loans
        </span>
        <Dot />
        <span>
          On-chain <span className="text-text">pricing</span>
        </span>
        <Dot />
        <span className="text-text">Immutable contracts</span>
      </div>
    </section>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-border" aria-hidden />;
}
