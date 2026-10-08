// Safe user-facing diagnostics only. Do not echo request descriptions, contacts,
// cities or submitted values to errors/analytics/logs.
const safeLabels: Record<string, string> = {
  category: "тип помощи",
  country: "страна",
  city: "город",
  description: "описание (не менее 20 символов)",
  urgency: "срочность",
  consent: "согласие на обработку данных",
};

export function helpRequestValidationMessage(issues: readonly { path: readonly PropertyKey[] }[]): string {
  const fields = [...new Set(issues.map(issue => safeLabels[String(issue.path[0])] || "обязательные поля"))];
  if (fields.length === 0) return "Проверьте обязательные поля обращения.";
  return "Проверьте: " + fields.join(", ") + ". Ваш текст остался в форме.";
}
