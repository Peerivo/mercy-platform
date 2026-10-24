"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale } from "./locale-provider";
import { analyticsCopy } from "@/lib/analytics-consent-copy";

declare global {
  interface Window {
    PeerivoObservability?: {
      activate: () => Promise<boolean>;
      pageview: () => void;
    };
  }
}

const key = "peerivo_analytics_consent_v2";
// Never activate for help forms, personal accounts, reports or request detail URLs.
const safe = (path: string) => ["/", "/requests", "/nearby"].includes(path);

function loadAdapter(): Promise<void> {
  if (window.PeerivoObservability) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/peerivo-observability-loader.v2.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("peerivo-consent-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("peerivo-consent-change", callback);
  };
};
const snapshot = (): "granted" | "denied" | null => {
  try {
    const value = window.localStorage.getItem(key);
    return value === "granted" || value === "denied" ? value : null;
  } catch { return null; }
};
const serverSnapshot = () => null;

export function AnalyticsConsent() {
  const pathname = usePathname() ?? "";
  const { locale } = useLocale();
  const copy = analyticsCopy[locale];
  const choice = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [showPanel, setShowPanel] = useState(false);
  const loaded = useRef(false);
  const lastPath = useRef<string|null>(null);


  useEffect(() => {
    // Wait for browser consent state after hydration.
    if (!safe(pathname)) {
      // Third-party scripts already running cannot safely be unloaded in an SPA.
      // Isolate private surfaces in a fresh document with no analytics bootstrap.
      if (loaded.current) window.location.reload();
      return;
    }
    if (choice !== "granted") return;
    let disposed = false;
    void loadAdapter().then(async () => {
      if (disposed) return;
      if (!loaded.current) {
        loaded.current = await window.PeerivoObservability?.activate() === true;
        lastPath.current = pathname;
      } else if (lastPath.current !== pathname) {
        lastPath.current = pathname;
        window.PeerivoObservability?.pageview();
      }
    }).catch(() => { /* analytics must never affect site availability */ });
    return () => {disposed = true;};
  }, [choice,pathname]);

  useEffect(() => {
    if (!loaded.current || choice !== "granted") return;
    const forceHardNavigationToPrivate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || safe(url.pathname)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(url.href);
    };
    document.addEventListener("click", forceHardNavigationToPrivate, true);
    return () => document.removeEventListener("click", forceHardNavigationToPrivate, true);
  }, [choice]);

  function decide(next: "granted"|"denied") {
    try { window.localStorage.setItem(key,next); } catch { /* never block page or force analytics */ }
    window.dispatchEvent(new Event("peerivo-consent-change"));
    setShowPanel(false);
    if (next === "denied" && loaded.current) {
      window.location.reload();
    }
  }

  if (!safe(pathname)) return null;
  return (
    <>
      {(choice === null || showPanel) && (
        <aside role="region" aria-label={copy.heading} className="analytics-consent">
          <strong>{copy.heading}</strong>
          <p>{copy.description} <a href="https://yandex.ru/legal/confidential/" target="_blank" rel="noopener noreferrer">{copy.policy}</a></p>
          <div className="analytics-consent-actions">
            <button className="btn secondary" type="button" onClick={() => decide("denied")}>{copy.reject}</button>
            <button className="btn" type="button" onClick={() => decide("granted")}>{copy.accept}</button>
          </div>
        </aside>
      )}
      {choice !== null && !showPanel && (
        <button className="analytics-consent-settings" type="button" onClick={() => choice === "granted" ? decide("denied") : setShowPanel(true)} aria-label={choice === "granted" ? copy.withdraw : copy.change}>
          {choice === "granted" ? copy.withdraw : copy.change}
        </button>
      )}
    </>
  );
}
