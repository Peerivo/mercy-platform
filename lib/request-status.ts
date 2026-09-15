export const PUBLIC_REQUEST_STATUS = {
  NEW: "Нужна помощь",
  ASSIGNED: "Помощь найдена",
  IN_PROGRESS: "Помощь найдена",
  WAITING: "Помощь найдена",
  RESOLVED: "Завершена",
  CLOSED: "Завершена",
} as const;

export function getPublicRequestStatus(status: string): string {
  return (
    PUBLIC_REQUEST_STATUS[
      status as keyof typeof PUBLIC_REQUEST_STATUS
    ] ?? "Статус уточняется"
  );
}