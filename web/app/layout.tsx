import type { Metadata } from "next";
import { ClientShell } from "./ClientShell";
import "./globals.css";

// Fonts come from the CSS stacks in globals.css (system-first) so the app builds and runs with no
// network dependency on Google Fonts; swap in vendored Inter/JetBrains Mono later if desired.

export const metadata: Metadata = {
  title: "Lifeline · MUSD rescue market on Mezo",
  description: "Stops MUSD borrowers on Mezo from being liquidated.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
