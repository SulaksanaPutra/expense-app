import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LedgerSplit — Shared Expense Ledger",
  description:
    "Group-isolated shared expense ledger with deterministic minor-unit splits, hybrid locking, and live sync.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas-parchment font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
