import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getRequestConsentVersion,
  getRequestJurisdiction,
} from "../lib/request-consent";

describe("request consent", () => {
  it("detects Georgia", () => {
    expect(
      getRequestJurisdiction("Грузия")
    ).toBe("ge");

    expect(
      getRequestJurisdiction("Georgia")
    ).toBe("ge");
  });

  it("uses Georgia consent v3", () => {
    expect(
      getRequestConsentVersion("Грузия")
    ).toBe("request-ge-v3");
  });

  it("uses Russia consent v3 by default", () => {
    expect(
      getRequestConsentVersion("Россия")
    ).toBe("request-ru-v3");

    expect(
      getRequestConsentVersion("")
    ).toBe("request-ru-v3");
  });
});