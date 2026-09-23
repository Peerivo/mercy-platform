# Donations

Mercy / «Язык милосердия» separates two money flows:

1. **Support the project** — voluntary support for operating and developing Mercy.
2. **Help a person** — must not be routed through the project donation page.

The public `/donate` page only implements the first flow.

## Current provider

The current provider adapter is **CloudTips** for a recipient acting as an individual.
The verified recipient page is:

```
https://pay.cloudtips.ru/p/4a70a8e5
```

The application does not process a payment itself. It links to the CloudTips-hosted
page. Card details never pass through Mercy, no payment credentials are stored in
this repository, and this increment does not introduce a donation ledger or database
migration.

The verified public URL is safe to keep as the built-in default because it is a
public payment destination, not a credential. Deployment configuration may override
it with:

```bash
NEXT_PUBLIC_DONATION_URL=https://<cloudtips-link>
```

The application accepts only HTTPS URLs on `cloudtips.ru` or its subdomains.
An invalid explicit override fails closed.

## Product boundary

- Do not route money for an individual help request through the project donation page.
- Do not promise a tax deduction for an individual-recipient transfer.
- Do not store card numbers, payment credentials, or payout secrets in Mercy.
- Do not add a privileged payment webhook until there is a real accounting need and
  a reviewed provider contract.
- If Mercy later uses a Russian NPO/fund, add it as another `DonationProvider`
  rather than changing the public page contract.

## Future NPO migration

When a partner or own NPO becomes the canonical recipient, the provider adapter may
switch to a nonprofit payment flow with one-time/recurring donations, purpose codes,
receipts/reporting where applicable, and a separate accounting ledger. The public
distinction between project support and help for a specific person must remain.
