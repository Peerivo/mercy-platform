[1mdiff --git a/app/safe/page.tsx b/app/safe/page.tsx[m
[1mindex 32bf702..d020896 100644[m
[1m--- a/app/safe/page.tsx[m
[1m+++ b/app/safe/page.tsx[m
[36m@@ -1,2 +1,5 @@[m
[31m-import {ReturnToService} from "@/components/return-to-service";[m
[31m-export default function Safe(){return <section className="page-shell section"><h1>Нейтральная страница</h1><p>Локальная сессия интерфейса очищена. Это действие не удаляет историю браузера — при необходимости очистите её в настройках устройства.</p><div className="nav"><a className="btn secondary" href="https://www.wikipedia.org">Перейти к энциклопедии</a><ReturnToService/></div></section>}[m
[32m+[m[32mimport { redirect } from "next/navigation";[m
[32m+[m
[32m+[m[32mexport default function SafePage() {[m
[32m+[m[32m  redirect("/auth");[m
[32m+[m[32m}[m
\ No newline at end of file[m
[1mdiff --git a/components/quick-exit.tsx b/components/quick-exit.tsx[m
[1mindex 86f6b18..bd6b370 100644[m
[1m--- a/components/quick-exit.tsx[m
[1m+++ b/components/quick-exit.tsx[m
[36m@@ -1,2 +1,2 @@[m
 "use client";[m
[31m-export function QuickExit(){function leave(){try{document.documentElement.setAttribute("data-mercy-quick-exit-guard","1");document.cookie.split(";").forEach(c=>{const n=c.split("=")[0].trim();if(n.startsWith("sb-"))document.cookie=`${n}=; Max-Age=0; path=/; SameSite=Lax`});localStorage.clear();sessionStorage.clear();sessionStorage.setItem("mercy_quick_exit","1")}finally{window.location.replace("/safe")}}return <button className="btn secondary" onClick={leave} aria-label="Быстро скрыть приватную страницу">Быстрый выход</button>}[m
[32m+[m[32mexport function QuickExit(){function leave(){try{document.documentElement.setAttribute("data-mercy-quick-exit-guard","1");document.cookie.split(";").forEach(c=>{const n=c.split("=")[0].trim();if(n.startsWith("sb-"))document.cookie=`${n}=; Max-Age=0; path=/; SameSite=Lax`});localStorage.clear();sessionStorage.clear();sessionStorage.setItem("mercy_quick_exit","1")}finally{window.location.replace("/auth")}}return <button className="btn secondary" onClick={leave} aria-label="Быстро скрыть приватную страницу">Быстрый выход</button>}[m
