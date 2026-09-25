import { describe, expect, it } from "vitest";
import { authLoginNotice } from "@/lib/auth-login-notice";

describe("authLoginNotice", () => {
  it("treats the email-send rate limit as a recently sent link, not a delivery failure", () => {
    expect(authLoginNotice("over_email_send_rate_limit")).toEqual({
      role: "status",
      message:
        "Ссылка для входа уже недавно отправлялась. Проверьте почту и подождите немного перед повторной отправкой.",
    });
  });

  it("explains callback failures separately from mail delivery failures", () => {
    expect(authLoginNotice("callback")).toEqual({
      role: "alert",
      message:
        "Ссылка для входа недействительна или уже использована. Запросите новую ссылку.",
    });
  });

  it("keeps an explicit generic delivery error for unknown codes", () => {
    expect(authLoginNotice("unexpected")).toEqual({
      role: "alert",
      message: "Не удалось отправить письмо. Проверьте email и попробуйте ещё раз.",
    });
  });
});
