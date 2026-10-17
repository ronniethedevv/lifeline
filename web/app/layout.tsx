import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClientShell } from "./ClientShell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Lifeline · MUSD rescue market on Mezo",
  description: "Stops MUSD borrowers on Mezo from being liquidated.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
