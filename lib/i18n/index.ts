import { georgian } from "./ka";

export type Locale = "ru" | "ka";
export const LOCALE_COOKIE = "mercy_locale";
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;
export function parseLocale(value?: string | null): Locale {
  return value === "ka" ? "ka" : "ru";
}
export function normalizeMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
export function translate(locale: Locale, message: string): string {
  const key = normalizeMessage(message);
  return locale === "ka" && Object.hasOwn(georgian, key) ? georgian[key] : message;
}
export const dateLocale = (locale: Locale) => locale === "ka" ? "ka-GE" : "ru-RU";

const enumLabels: Record<string, string> = {
  PREGNANCY: "Беременность и материнство", FAMILY: "Семья", HOUSING: "Жильё",
  FOOD_GOODS: "Продукты и вещи", LEGAL_DOCUMENTS: "Документы и право",
  WORK_EDUCATION: "Работа и обучение", OTHER: "Другое",
  NORMAL: "Обычная", SOON: "Желательно скоро", URGENT: "Срочно",
  NEW: "Новая", ASSIGNED: "Назначена", IN_PROGRESS: "В работе", WAITING: "Ожидание",
  RESOLVED: "Решена", CLOSED: "Закрыта", PENDING: "На проверке",
  VERIFIED: "Проверено", REJECTED: "Отклонено", DONE: "Выполнено",
  TODO: "Запланировано", PLANNED: "Запланировано", CANCELLED: "Отменено",
  THINGS: "Вещи", TRANSPORT: "Транспорт", FOOD: "Продукты",
  CHILDCARE: "Краткая помощь с детьми", EDUCATION_WORK: "Учёба и работа",
  FREE: "Бесплатно", PAID: "Платно", MIXED: "Частично платно", UNKNOWN: "Уточняется",
  ONLINE: "Онлайн", OFFLINE: "Очно", ru: "Русский", ka: "Грузинский", en: "Английский",
};
export function enumLabel(t: (message: string) => string, value: string): string {
  return Object.hasOwn(enumLabels, value) ? t(enumLabels[value]) : value;
}
