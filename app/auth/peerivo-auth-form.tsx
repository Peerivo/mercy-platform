"use client";

import { createElement, useState } from "react";
import Script from "next/script";

type Capabilities = { google: boolean; password: boolean; available: boolean };

const SCRIPT = "https://auth.peerivo.net/embed/peerivo-auth-form.v1.js";

/** Central Auth owns all password inputs; Mercy only owns its browser-bound OAuth start. */
export function PeerivoAuthForm({ next, capabilities }: { next: string; capabilities: Capabilities }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const oauth = (provider?: "google") => `/auth/start?next=${encodeURIComponent(next)}${provider ? "&provider=google" : ""}`;
  const fallback = <a className="btn" href={oauth()}>Войти через Peerivo</a>;

  return <div className="mercy-peerivo-auth-widget" aria-label="Единый вход Peerivo ID">
    <Script src={SCRIPT} strategy="afterInteractive"
      onReady={() => { setReady(true); setFailed(false); }}
      onError={() => { setReady(false); setFailed(true); }} />
    {ready && capabilities.available ? createElement("peerivo-auth-form", {
      title: "Войти в «Язык милосердия»",
      subtitle: "Один Peerivo ID для всех сервисов.",
      "client-id": "mercy",
      "available": String(capabilities.available),
      "google-enabled": String(capabilities.google),
      "password-enabled": String(capabilities.password),
      "google-url": oauth("google"),
      "peerivo-url": oauth(),
      "start-url": "/auth/prepare",
      "callback-path": "/auth/callback",
      next,
      lang: "ru",
    }, fallback) : <div role="status">
      {failed ? <p>Не удалось загрузить форму Peerivo ID. Используйте прямой вход.</p> : null}
      {fallback}
    </div>}
  </div>;
}
