export type DonationProviderKind = "individual" | "nonprofit";

export const DEFAULT_DONATION_URL = "https://pay.cloudtips.ru/p/4a70a8e5";

export type DonationProvider = {
  id: "cloudtips";
  name: string;
  kind: DonationProviderKind;
  href: string | null;
  isConfigured: boolean;
};

export function normalizeCloudTipsDonationUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();

    if (
      url.protocol !== "https:" ||
      (host !== "cloudtips.ru" && !host.endsWith(".cloudtips.ru"))
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function getDonationProvider(): DonationProvider {
  const href = normalizeCloudTipsDonationUrl(
    process.env.NEXT_PUBLIC_DONATION_URL || DEFAULT_DONATION_URL,
  );

  return {
    id: "cloudtips",
    name: "CloudTips",
    kind: "individual",
    href,
    isConfigured: Boolean(href),
  };
}
