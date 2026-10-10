import { describe, expect, test } from "vitest";
import { helpRequestValidationMessage } from "../lib/request-form-feedback";

describe("Mercy request form safe feedback", () => {
  test("names only allowlisted invalid fields, never user values", () => {
    expect(helpRequestValidationMessage([{ path: ["description"] }, { path: ["city"] }]))
      .toBe("Проверьте: описание (не менее 20 символов), город. Ваш текст остался в форме.");
    const message = helpRequestValidationMessage([{ path: ["confidential-user-email@example.com"] }]);
    expect(message).toContain("обязательные поля");
    expect(message).not.toContain("confidential-user-email");
    expect(helpRequestValidationMessage([])).toBe("Проверьте обязательные поля обращения.");
  });
});
