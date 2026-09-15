import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uniseller · Admin Panel",
  description: "Аккаунты, группы Telegram и запросы потенциальных клиентов Uniseller.",
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
    <html lang="ru">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
