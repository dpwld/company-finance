import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Workspace",
  description: "사업비 · 거래 · 증빙 · TIPS 연구비 워크스페이스",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
