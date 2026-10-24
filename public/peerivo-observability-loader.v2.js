(() => {
  "use strict";
  // Shared public-web loader. Activation ONLY after explicit analytics consent.
  // Version 1 GTM-only loader is preserved for existing sites during migration.
  const MANIFEST = "/site-observability.json";
  let enabled = false;
  let running = false;
  let activeManager = null;
  const safePath = (pathname) => ["/", "/requests", "/nearby"].includes(pathname);

  function signal(reason) {
    try { window.dispatchEvent(new CustomEvent("peerivo:observability-error", { detail: { reason } })); } catch {}
  }
  function exactKeys(value, allowed) {
    return !!value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).every((key) => allowed.includes(key));
  }
  function valid(m) {
    return exactKeys(m, ["apiVersion", "kind", "schemaVersion", "site", "manager", "consent", "availability", "secretsAllowed"]) &&
      exactKeys(m.site, ["siteId", "environment", "origin"]) &&
      exactKeys(m.manager, m.manager?.type === "ytm" ? ["type","counterId"] : ["type","containerId"]) &&
      exactKeys(m.consent, ["jurisdictionAware","analyticsStorageDefault","advertisingStorageDefault","elevatedCollectionDefault"]) &&
      exactKeys(m.availability, ["analyticsFailureMayBreakPage"]) &&
      m.apiVersion === "peerivo.io/web-observability/v2" && m.kind === "SiteObservabilityManifest" &&
      m.schemaVersion === 2 && typeof m.site.siteId === "string" && m.site.siteId.length > 0 &&
      ["production","preview","staging","development","test"].includes(m.site.environment) &&
      m.site.origin === window.location.origin &&
      ((m.manager.type === "ytm" && typeof m.manager.counterId === "string" && /^[1-9][0-9]{0,11}$/.test(m.manager.counterId)) ||
       (m.manager.type === "gtm" && typeof m.manager.containerId === "string" && /^GTM-[A-Z0-9]+$/.test(m.manager.containerId))) &&
      m.consent.jurisdictionAware === true && m.consent.analyticsStorageDefault === "denied" &&
      m.consent.advertisingStorageDefault === "denied" && m.consent.elevatedCollectionDefault === "disabled" &&
      m.availability.analyticsFailureMayBreakPage === false && m.secretsAllowed === false;
  }
  function inject(source, onError) {
    const script = document.createElement("script");
    script.async = true;
    script.src = source;
    script.onerror = () => signal(onError);
    document.head.appendChild(script);
  }
  async function activate() {
    if (enabled || running || !safePath(window.location.pathname)) return false;
    running = true;
    try {
      const response = await fetch(MANIFEST, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("unavailable");
      const m = await response.json();
      if (!valid(m)) { signal("manifest_invalid"); return false; }
      if (m.manager.type === "ytm") {
        const id = Number(m.manager.counterId);
        window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
        window.ym.l = window.ym.l || Date.now();
        // Yandex Tag Manager is activated in this particular Metrica counter's UI.
        window.ym(id, "init", { ssr: true, clickmap: false, trackLinks: false, trackHash: false, accurateTrackBounce: false, webvisor: false, sendTitle: false });
        inject("https://mc.yandex.ru/metrika/tag.js?id=" + encodeURIComponent(m.manager.counterId), "ytm_load_failed");
      } else {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: "peerivo_analytics_consent_granted" });
        window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
        inject("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(m.manager.containerId), "gtm_load_failed");
      }
      enabled = true;
      activeManager = m.manager;
      return true;
    } catch { signal("manifest_unavailable"); return false; }
    finally { running = false; }
  }
  // Unloading analytics after withdrawal requires a full reload; the caller must
  // first persist a DENIED choice and then reload the document.
  function revoke() { enabled = false; activeManager = null; window.location.reload(); }
  function pageview() {
    if (!enabled || !activeManager || !safePath(window.location.pathname)) return;
    // Only later SPA views; initialization already accounts for first page view.
    // No query strings, fragments, user ids or form values are sent.
    if (activeManager.type === "ytm" && typeof window.ym === "function")
      window.ym(Number(activeManager.counterId), "hit", window.location.origin + window.location.pathname);
    else if (activeManager.type === "gtm" && Array.isArray(window.dataLayer))
      window.dataLayer.push({event:"peerivo_public_pageview",page_path:window.location.pathname});
  }
  window.PeerivoObservability = Object.freeze({activate,revoke,pageview});
})();
