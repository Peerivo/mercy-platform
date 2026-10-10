import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { translate, type Locale } from "../lib/i18n";

const state = vi.hoisted(() => ({ locale: "ru" as "ru" | "ka" }));
vi.mock("@/lib/i18n/server", () => ({ getTranslations: async () => ({ locale: state.locale, t: (message: string) => translate(state.locale, message) }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("../app/auth/actions", () => ({ sendLoginLink: vi.fn(), updatePassword: vi.fn() }));
vi.mock("../app/feedback/actions", () => ({ submitFeedback: vi.fn() }));
vi.mock("../app/volunteer/actions", () => ({ createOffer: vi.fn() }));
vi.mock("@/lib/peerivo-auth", () => ({ isPeerivoAuthEnabled: () => false }));
import Volunteer from "../app/volunteer/page";
import Feedback from "../app/feedback/page";
import Auth from "../app/auth/page";
import UpdatePassword from "../app/auth/update-password/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cases = [
  { name: "volunteer", page: Volunteer, fields: { country: "საქართველო", city: "თბილისი", description: "fictional volunteer description", contact_method: "fictional contact" }, checkbox: "online" },
  { name: "feedback", page: Feedback, fields: { message: "fictional feedback", replyEmail: "fixture@example.invalid", pagePath: "/help" }, checkbox: null },
  { name: "email sign-in", page: Auth, fields: { email: "fixture@example.invalid" }, checkbox: null },
  { name: "password update", page: UpdatePassword, fields: { password: "fictional-password-only" }, checkbox: null },
];

describe("server form DOM preservation on localized React refresh", () => {
  for (const scenario of cases) it(`preserves ${scenario.name} inputs through RU/KA/RU server re-renders`, async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const render = async (locale: Locale) => {
      state.locale = locale;
      const content = await scenario.page({ searchParams: Promise.resolve({}) });
      await act(async () => root.render(content));
    };
    try {
      await render("ru");
      for (const [name, value] of Object.entries(scenario.fields)) {
        const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
        input.value = value;
      }
      if (scenario.checkbox) container.querySelector<HTMLInputElement>(`[name="${scenario.checkbox}"]`)!.checked = true;
      for (const locale of ["ka", "ru"] as const) {
        await render(locale);
        for (const [name, value] of Object.entries(scenario.fields)) expect(container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!.value).toBe(value);
        if (scenario.checkbox) expect(container.querySelector<HTMLInputElement>(`[name="${scenario.checkbox}"]`)!.checked).toBe(true);
        if (locale === "ka") expect(container.querySelector("h1")!.textContent).toMatch(/[ა-ჰ]/);
      }
    } finally {
      await act(async () => root.unmount()); container.remove();
    }
  });
});
