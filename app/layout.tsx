import "./globals.css";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { QuickExit } from "@/components/quick-exit";
import { quickExitGuard } from "@/lib/quick-exit-guard";

export const metadata: Metadata = {
  title: "Язык милосердия",
  description: "Спокойная и практическая поддержка в трудной ситуации",
  robots: { index: true, follow: true },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Script id="mercy-quick-exit-guard" strategy="beforeInteractive">
          {quickExitGuard}
        </Script>
        <header>
          <div className="page-shell nav">
            <Link className="brand" href="/" aria-label="Язык милосердия — главная">
              <Image className="brand-icon" src="/icon.svg" alt="" width={32} height={32} />
              <strong>Язык милосердия</strong>
            </Link>
            <span className="spacer" />
            <Link href="/nearby">Помощь рядом</Link>
            <Link href="/help">Нужна помощь</Link>
            <Link href="/volunteer">Хочу помочь</Link>
            <Link href="/cabinet">Кабинет</Link>
            <QuickExit />
          </div>
        </header>
        <main>{children}</main>
        <footer className="page-shell section muted">
          © Проект поддержки. Не медицинская организация и не круглосуточная экстренная служба.
        </footer>
      </body>
    </html>
  );
}
