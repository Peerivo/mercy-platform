import { describe, expect, it } from "vitest";
import { getPublicRequestStatus } from "../lib/request-status";

describe("public request status", () => {
  it("maps NEW", () => {
    expect(getPublicRequestStatus("NEW")).toBe(
      "Нужна помощь"
    );
  });

  it("maps ASSIGNED", () => {
    expect(
      getPublicRequestStatus("ASSIGNED")
    ).toBe("Помощь найдена");
  });

  it("maps IN_PROGRESS", () => {
    expect(
      getPublicRequestStatus("IN_PROGRESS")
    ).toBe("Помощь найдена");
  });

  it("maps WAITING", () => {
    expect(
      getPublicRequestStatus("WAITING")
    ).toBe("Помощь найдена");
  });

  it("maps RESOLVED", () => {
    expect(
      getPublicRequestStatus("RESOLVED")
    ).toBe("Завершена");
  });

  it("maps CLOSED", () => {
    expect(
      getPublicRequestStatus("CLOSED")
    ).toBe("Завершена");
  });

  it("does not expose unknown internal status", () => {
    expect(
      getPublicRequestStatus("UNKNOWN")
    ).toBe("Статус уточняется");
  });
});