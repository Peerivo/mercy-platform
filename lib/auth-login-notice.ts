export type AuthLoginNotice = {
  role: "alert" | "status";
  message: string;
};

export function authLoginNotice(code?: string | null): AuthLoginNotice | null {
  if (!code) return null;

  if (code === "over_email_send_rate_limit") {
    return {
      role: "status",
      message:
        "Ссылка для входа уже недавно отправлялась. Проверьте почту и подождите немного перед повторной отправкой.",
    };
  }

  if (code === "callback") {
    return {
      role: "alert",
      message:
        "Ссылка для входа недействительна или уже использована. Запросите новую ссылку.",
    };
  }

  if (code === "session") {
    return {
      role: "alert",
      message:
        "Сессия входа не найдена или уже завершена. Запросите новую ссылку для входа.",
    };
  }

  if (code === "peerivo-config") {
    return {
      role: "alert",
      message: "Peerivo ID ещё не настроен для этой среды. Используйте вход по email или проверьте переменные окружения.",
    };
  }

  if (code === "peerivo-state") {
    return {
      role: "alert",
      message: "Сессия входа через Peerivo устарела. Попробуйте войти ещё раз.",
    };
  }

  if (code === "peerivo-callback") {
    return {
      role: "alert",
      message: "Не удалось завершить вход через Peerivo. Попробуйте снова или используйте вход по email.",
    };
  }

  return {
    role: "alert",
    message: "Не удалось отправить письмо. Проверьте email и попробуйте ещё раз.",
  };
}
