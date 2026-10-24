"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
const safe = (path: string) => ["/", "/requests", "/nearby", "/volunteer", "/donate"].includes(path);

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

export function AnalyticsConsent() {
  const pathname = usePathname() ?? "";
  const { locale } = useLocale();
  const copy = analyticsCopy[locale];
  const [choice, setChoice] = useState<"granted"|"denied"|null>(null);
  const [ready, setReady] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const loaded = useRef(false);
  const lastPath = useRef<string|null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(key); } catch { /* privacy mode: remain denied unless explicit choice */ }
    setChoice(saved === "granted" || saved === "denied" ? saved : null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
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
  }, [choice,pathname,ready]);

  function decide(next: "granted"|"denied") {
    try { window.localStorage.setItem(key,next); } catch { /* never block page or force analytics */ }
    setChoice(next);
    setShowPanel(false);
    if (next === "denied" && loaded.current) {
      window.location.reload();
    }
  }

  if (!ready || !safe(pathname)) return null;
  return (
    <>
      {(choice === null || showPanel) && (
        <aside role="region" aria-label={copy.heading} className="analytics-consent">
          <strong>{copy.heading}</strong>
          <p>{copy.description}</p>
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
