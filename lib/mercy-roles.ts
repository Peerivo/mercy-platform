export const ROLE_LABELS = {
  VOLUNTEER: "Волонтёр",
  CURATOR: "Куратор",
  PATRON: "Меценат",
  ADMIN: "Администратор",
} as const;

export const PATRON_KIND_LABELS = {
  PERSON: "Физическое лицо",
  SOLE_PROPRIETOR: "ИП",
  LEGAL_ENTITY: "Юридическое лицо",
  GOVERNMENT: "Государственная структура",
} as const;

export const VOLUNTEER_STATUS_LABELS = {
  ONBOARDING: "Подготовка",
  ACTIVE: "Активен",
  PAUSED: "На паузе",
  SUSPENDED: "Приостановлен",
} as const;

export const HOME_CLEARANCE_LABELS = {
  NOT_CLEARED: "Домашние визиты не разрешены",
  CLEARED: "Допущен к домашним визитам",
  SUSPENDED: "Допуск приостановлен",
} as const;

export const VOLUNTEER_CATEGORY_LABELS = {
  THINGS: "Вещи",
  TRANSPORT: "Транспорт",
  FOOD: "Продукты",
  CHILDCARE: "Помощь с детьми",
  EDUCATION_WORK: "Учёба и работа",
  OTHER: "Другое",
} as const;

export const ASSIGNMENT_MODE_LABELS = {
  REMOTE: "Дистанционно",
  PUBLIC_PLACE: "В общественном месте",
  HOME_PAIRED: "Домашний визит парой",
} as const;

export const BENEFICIARY_CONSENT_LABELS = {
  NOT_REQUIRED: "Проситель — сам подопечный",
  PENDING: "Согласие ожидается",
  CONFIRMED: "Согласие подтверждено",
  DECLINED: "Согласие не дано",
} as const;
