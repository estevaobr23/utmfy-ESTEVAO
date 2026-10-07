import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UTMFY Tracker",
  description: "Tracking e atribuição de vendas (Cakto + Meta)",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
