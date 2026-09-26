import { RUSSIAN_CITIES } from "./russian-cities";
import { RUSSIAN_URBAN_SETTLEMENTS } from "./russian-urban-settlements";

export type RussianLocality = Readonly<{
  name: string;
  region: string;
  kind: "город" | "посёлок";
  population?: number | null;
}>;

function key(name: string, region: string) {
  return `${name.trim().toLocaleLowerCase("ru-RU")}\u0000${region
    .trim()
    .toLocaleLowerCase("ru-RU")}`;
}

const merged = new Map<string, RussianLocality>();

for (const city of RUSSIAN_CITIES) {
  merged.set(key(city.name, city.region), {
    ...city,
    kind: "город",
  });
}

for (const settlement of RUSSIAN_URBAN_SETTLEMENTS) {
  const itemKey = key(settlement.name, settlement.region);
  if (!merged.has(itemKey)) {
    merged.set(itemKey, {
      ...settlement,
      kind: "посёлок",
    });
  }
}

export const RUSSIAN_LOCALITIES: readonly RussianLocality[] = [...merged.values()].sort(
  (a, b) =>
    a.name.localeCompare(b.name, "ru") || a.region.localeCompare(b.region, "ru"),
);

export function findKnownRussianLocality(name: string) {
  const normalized = name.trim().toLocaleLowerCase("ru-RU");
  return RUSSIAN_LOCALITIES.find(
    (item) => item.name.trim().toLocaleLowerCase("ru-RU") === normalized,
  );
}

export function isKnownRussianLocality(name: string) {
  return Boolean(findKnownRussianLocality(name));
}
