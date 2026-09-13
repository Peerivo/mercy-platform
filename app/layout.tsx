import "./globals.css";
import Link from "next/link";
import Script from "next/script";
import { QuickExit } from "@/components/quick-exit";
import { quickExitGuard } from "@/lib/quick-exit-guard";
export const metadata={title:"Язык милосердия",description:"Спокойная и практическая поддержка в трудной ситуации",robots:{index:true,follow:true}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body><Script id="mercy-quick-exit-guard" strategy="beforeInteractive">{quickExitGuard}</Script><header className="container nav"><Link href="/"><strong>Язык милосердия</strong></Link><span className="spacer"/><Link href="/nearby">Помощь рядом</Link><Link href="/help">Нужна помощь</Link><Link href="/volunteer">Хочу помочь</Link><Link href="/cabinet">Кабинет</Link><QuickExit/></header><main>{children}</main><footer className="container section muted">© Проект поддержки. Не медицинская организация и не круглосуточная экстренная служба.</footer></body></html>}
