import "./globals.css";
import "./polish.css";
import "./public-pages.css";
import "./mobile-shell.css";
import "./brand.css";
import "./cabinet.css";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { AuthEntry } from "@/components/auth-entry";
import { MobileMenu } from "@/components/mobile-menu";
import { QuickExit } from "@/components/quick-exit";
import { quickExitGuard } from "@/lib/quick-exit-guard";
import { siteUrl } from "@/lib/config";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Язык милосердия",
  description: "Спокойная и практическая поддержка в трудной ситуации",
  robots: { index: true, follow: true },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/mercy-m.png",
  },
};

const navigation = [
  { href: "/requests", label: "Просьбы" },
  { href: "/nearby", label: "Помощь рядом" },
  { href: "/help", label: "Нужна помощь" },
  { href: "/volunteer", label: "Хочу помочь" },
  { href: "/donate", label: "Поддержать" },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Script id="mercy-quick-exit-guard" strategy="beforeInteractive">
          {quickExitGuard}
        </Script>

        <header className="site-header">
          <div className="page-shell site-header-inner">
            <Link className="brand" href="/" aria-label="Язык милосердия — главная">
              <Image className="brand-icon" src="/icon.svg" alt="" width={34} height={34} priority />
              <span className="brand-copy">
                <strong>Язык милосердия</strong>
                <small>люди помогают людям</small>
              </span>
            </Link>

            <nav className="desktop-nav" aria-label="Основная навигация">
              {navigation.map((item) => (
                <Link href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="site-header-actions">
              <AuthEntry className="btn secondary header-auth-entry" />
              <QuickExit />
              <MobileMenu items={navigation} />
            </div>
          </div>
        </header>

        <main>{children}</main>

        <footer className="site-footer">
          <div className="page-shell site-footer-inner">
            <div>
              <strong>Язык милосердия</strong>
              <p>Добровольная и практическая помощь людей людям.</p>
              <p>
                <Link href="/feedback">Обратная связь</Link>
                {" · "}
                <Link href="/donate">Поддержать проект</Link>
              </p>
            </div>
            <p className="footer-safety">
              При непосредственной угрозе жизни или безопасности обращайтесь в местную экстренную службу.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
