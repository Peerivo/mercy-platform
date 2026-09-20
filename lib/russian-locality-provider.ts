import { findKnownRussianLocality } from "@/lib/russian-localities";

export type LocalityVerification = Readonly<{
  verified: boolean;
  providerAvailable: boolean;
  source: "catalog" | "hintdata" | "fias-public" | "none";
  canonicalName?: string;
  region?: string;
  fiasId?: string;
  fullAddress?: string;
}>;

const HINTDATA_URL = "https://api.hintdata.ru/v1/suggest/address";
const FIAS_PUBLIC_URL = "https://fias-public-api.nalog.ru/api/addresses/search";
const PROVIDER_TIMEOUT_MS = 3500;

function normalize(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ");
}

function localitySegment(value: string) {
  return normalize(value).replace(
    /^(г|город|пгт|рп|кп|пос|поселок|посёлок|с|село|д|деревня|ст-ца|станица)\s+/,
    "",
  );
}

function matchesLocality(fullAddress: string, query: string) {
  const expected = localitySegment(query);
  return fullAddress
    .split(",")
    .map(localitySegment)
    .some((segment) => segment === expected);
}

async function verifyWithHintData(query: string): Promise<LocalityVerification | null> {
  const apiKey = process.env.HINTDATA_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(HINTDATA_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        count: 10,
        from_bound: { value: "city" },
        to_bound: { value: "settlement" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        verified: false,
        providerAvailable: response.status < 500,
        source: "hintdata",
      };
    }

    const body = (await response.json()) as {
      suggestions?: Array<{
        value?: string;
        full?: string;
        fias_id?: string;
        address?: { region?: string; city?: string; settlement?: string };
        components?: {
          city?: { name?: string; fias_id?: string };
          settlement?: { name?: string; fias_id?: string };
        };
      }>;
    };

    const expected = normalize(query);
    const candidate = body.suggestions?.find((item) => {
      const name =
        item.components?.settlement?.name ??
        item.components?.city?.name ??
        item.address?.settlement ??
        item.address?.city ??
        "";
      return normalize(name) === expected;
    });

    if (!candidate) {
      return {
        verified: false,
        providerAvailable: true,
        source: "hintdata",
      };
    }

    const canonicalName =
      candidate.components?.settlement?.name ??
      candidate.components?.city?.name ??
      candidate.address?.settlement ??
      candidate.address?.city ??
      query;

    return {
      verified: true,
      providerAvailable: true,
      source: "hintdata",
      canonicalName,
      region: candidate.address?.region,
      fiasId:
        candidate.components?.settlement?.fias_id ??
        candidate.components?.city?.fias_id ??
        candidate.fias_id,
      fullAddress: candidate.full ?? candidate.value,
    };
  } catch {
    return null;
  }
}

async function verifyWithPublicFias(query: string): Promise<LocalityVerification | null> {
  try {
    const url = new URL(FIAS_PUBLIC_URL);
    url.searchParams.set("searchText", query);
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("pageIndex", "0");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as unknown;
    const objectBody = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const rows = Array.isArray(body)
      ? body
      : Array.isArray(objectBody.items)
        ? objectBody.items
        : Array.isArray(objectBody.addresses)
          ? objectBody.addresses
          : Array.isArray(objectBody.data)
            ? objectBody.data
            : [];

    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const fullAddress = String(
        item.fullAddress ?? item.address ?? item.full_address ?? "",
      );
      const directName = String(
        item.name ?? item.objectName ?? item.formalName ?? "",
      );

      if (
        normalize(directName) !== normalize(query) &&
        !matchesLocality(fullAddress, query)
      ) {
        continue;
      }

      const fiasId = String(
        item.objectGuid ?? item.objectGUID ?? item.fiasId ?? item.fias_id ?? "",
      );

      return {
        verified: true,
        providerAvailable: true,
        source: "fias-public",
        canonicalName: directName || query,
        fiasId: fiasId || undefined,
        fullAddress: fullAddress || undefined,
      };
    }

    return {
      verified: false,
      providerAvailable: true,
      source: "fias-public",
    };
  } catch {
    return null;
  }
}

export async function verifyRussianLocality(
  query: string,
): Promise<LocalityVerification> {
  const known = findKnownRussianLocality(query);
  if (known) {
    return {
      verified: true,
      providerAvailable: true,
      source: "catalog",
      canonicalName: known.name,
      region: known.region,
    };
  }

  // A configured GAR/FIAS-backed provider is preferred because it is reachable
  // from Vercel globally. The official public endpoint remains the zero-key
  // fallback and may be geographically restricted by the FNS perimeter.
  const hintData = await verifyWithHintData(query);
  if (hintData?.verified || hintData?.providerAvailable) return hintData;

  const fias = await verifyWithPublicFias(query);
  if (fias) return fias;

  return {
    verified: false,
    providerAvailable: false,
    source: "none",
  };
}
