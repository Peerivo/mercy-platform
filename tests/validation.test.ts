import { describe, expect, it } from "vitest";

import {
  assignmentSchema,
  caseStatusSchema,
  feedbackSchema,
  offerSchema,
  requestResponseSchema,
  requestSchema,
  staffPageSchema,
  volunteerReviewSchema,
} from "../lib/validation";

describe("help request validation", () => {
  const valid = {
    category: "FAMILY",
    country: "Тестландия",
    city: "Примерск",
    description: "Достаточно длинное тестовое описание.",
    urgency: "NORMAL",
    can_message: true,
    can_call: false,
    contact_window: "",
    external_contact: "",
    consent: true,
  };

  it("accepts minimal non-medical request", () =>
    expect(requestSchema.safeParse(valid).success).toBe(true));

  it("requires explicit consent", () =>
    expect(requestSchema.safeParse({ ...valid, consent: false }).success).toBe(
      false
    ));

  it("bounds private text", () =>
    expect(
      requestSchema.safeParse({ ...valid, description: "x".repeat(5001) })
        .success
    ).toBe(false));

  it("requires complete private safety details for a home visit", () => {
    const homeVisit = {
      ...valid,
      home_visit_required: true,
      visit_household_members: "Живу одна",
      dogs_present: true,
      cats_present: false,
      visit_animals_notes: "Собака будет в другой комнате",
      smoking_present: false,
      visit_allergen_notes: "Особенностей нет",
      visit_access_notes: "Четвёртый этаж, лифта нет",
      visit_other_notes: "",
      visit_trusted_contact: "Дочь, связь через чат",
      video_call_possible: true,
      visit_safety_acknowledged: true,
    };
    expect(requestSchema.safeParse(homeVisit).success).toBe(true);
    expect(requestSchema.safeParse({ ...homeVisit, visit_household_members: "" }).success).toBe(false);
    expect(requestSchema.safeParse({ ...homeVisit, visit_safety_acknowledged: false }).success).toBe(false);
  });
});

describe("volunteer offer validation", () => {
  const valid = {
    category: "FOOD",
    country: "Тестландия",
    city: "Примерск",
    online: false,
    description: "Достаточно длинное предложение помощи.",
    contact_method: "Чат",
    consent: true,
  };

  it("requires consent and an offline city", () => {
    expect(offerSchema.safeParse(valid).success).toBe(true);
    expect(offerSchema.safeParse({ ...valid, consent: false }).success).toBe(
      false
    );
    expect(offerSchema.safeParse({ ...valid, city: "" }).success).toBe(false);
  });

  it("allows online help without a city and bounds moderation", () => {
    expect(
      offerSchema.safeParse({ ...valid, online: true, city: "" }).success
    ).toBe(true);
    expect(
      volunteerReviewSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        status: "VERIFIED",
        reason: "Проверено",
      }).success
    ).toBe(true);
  });
});

describe("request response validation", () => {
  const valid = {
    caseId: "00000000-0000-4000-8000-000000000001",
    message: "Могу помочь сегодня вечером.",
    contactMethod: "Telegram @helper",
    consent: true,
  };

  it("accepts a private response with explicit consent", () => {
    expect(requestResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing consent and short contact data", () => {
    expect(
      requestResponseSchema.safeParse({ ...valid, consent: false }).success
    ).toBe(false);
    expect(
      requestResponseSchema.safeParse({ ...valid, contactMethod: "x" }).success
    ).toBe(false);
  });
});

describe("feedback validation", () => {
  it("allows anonymous feedback without reply email", () => {
    expect(
      feedbackSchema.safeParse({
        message: "Регистрация была непонятной",
        replyEmail: "",
        pagePath: "/auth",
      }).success
    ).toBe(true);
  });

  it("validates optional reply email", () => {
    expect(
      feedbackSchema.safeParse({
        message: "Есть проблема",
        replyEmail: "not-an-email",
        pagePath: "",
      }).success
    ).toBe(false);
  });
});

describe("staff workspace validation", () => {
  const caseId = "00000000-0000-4000-8000-000000000001";
  const coordinatorId = "00000000-0000-4000-8000-000000000002";

  it("accepts bounded pages and complete assignments", () => {
    expect(staffPageSchema.parse("2")).toBe(2);
    expect(
      assignmentSchema.safeParse({
        caseId,
        coordinatorId,
        currentCoordinatorId: "",
        reason: "Новая смена",
      }).success
    ).toBe(true);
  });

  it("rejects same assignee, short reasons and unknown statuses", () => {
    expect(
      assignmentSchema.safeParse({
        caseId,
        coordinatorId,
        currentCoordinatorId: coordinatorId,
        reason: "valid reason",
      }).success
    ).toBe(false);
    expect(
      assignmentSchema.safeParse({
        caseId,
        coordinatorId,
        currentCoordinatorId: "",
        reason: "x",
      }).success
    ).toBe(false);
    expect(caseStatusSchema.safeParse({ caseId, status: "NEW" }).success).toBe(
      false
    );
  });
});
