export type RequestJurisdiction = "ru" | "ge";

export function getRequestJurisdiction(
  country?: string | null,
): RequestJurisdiction {
  const value = (country ?? "")
    .trim()
    .toLowerCase();

  const georgia = [
    "грузия",
    "georgia",
    "ge",
    "geo",
    "საქართველო",
  ];

  return georgia.includes(value)
    ? "ge"
    : "ru";
}

export function getRequestConsentVersion(
  country?: string | null,
) {
  return getRequestJurisdiction(country) ===
    "ge"
    ? "request-ge-v2"
    : "request-ru-v2";
}