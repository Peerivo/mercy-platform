# Mercy Analytics WEB-OBS v2 — release integration

Implementation: `lib/analytics-config.ts`, `app/site-observability.json/route.ts`, `components/analytics-consent.tsx`, `public/peerivo-observability-loader.v2.js`.

- Preferred Yandex Tag Manager, bootstrapped by **site-specific Yandex Metrica counter**. GTM can be selected instead but never simultaneously. All sites reuse the versioned adapter, NOT the counter ID.
- Each counter must be created by the account owner at https://metrika.yandex.ru/ and **Yandex Tag Manager enabled in Settings → Counter**. GA4, when needed, is configured as a project-approved managed tag inside YTM. Without the number/config, live analytics is deliberately **not enabled**.
- A runtime file mounted on REG.RU outside the repository and application image is selected using the `PEERIVO_ANALYTICS_REGISTRY_PATH` environment variable (absolute path; JSON, non-secret). It can be updated without rebuilding the Next.js app. Example (Mercy ID confirmed by owner; remove unconfigured Food entry before use):
```json
{
  "sites": [
    {"siteId":"mercy","origin":"https://mercy.peerivo.net","manager":{"type":"ytm","counterId":"113766177"}}
  ]
}
```
- Exact origin lookup; unknown/duplicate hostname, missing/invalid counter, extra fields or HTTP origin means 503 from `/site-observability.json`. No fallback or shared counter.
- Consent is denied by default and stored **per origin** (choice only, never form data). No analytic script or manifest request until consent; the loader validates the manifest and current origin again. Withdrawing after scripts loaded forces a document reload to unload them.
- Only public index routes `/`, `/requests`, `/nearby`, `SENSITIVE_VOLUNTEER_PAGE`, `DONATE_PAGE_UNTRACKED` can activate analytics. `/help`, all auth, staff, cabinet, individual request/chat pages remain excluded; client nav to private page reloads to discard analytics script. No URL query, request id, private contacts or form content enters custom pageview events.
- Webvisor, clickmap, link tracking and advertising disabled in bootstrap. An active YTM container may add its own tags; review those settings for privacy/consent before publishing.
- Maintain WEB-OBS-009 as open until runtime file is valid, the official tag UI has been configured, actual browser traffic and provider tags verified, the domain DNS TXT evidence available, and site availability remains unaffected when analytics fails. App integration or a green unit test alone does NOT close that gate.

Do not invent IDs, alter DNS, enable paid products, or declare publication complete without a real counter and verification.
