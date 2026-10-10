import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { HelpForm } from "../app/help/help-form";

const action = vi.hoisted(() => vi.fn());
const serverSupabase = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ serverSupabase }));
vi.mock("../app/help/actions", () => ({ createRequest: action }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
async function render(locale: "ru" | "ka") {
  await act(async () => root.render(<LocaleProvider locale={locale}><HelpForm /></LocaleProvider>));
}
function input(name: string) {
  return container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
}
async function fill(name: string, value: string) {
  const element = input(name);
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("help draft stays in memory across locale refresh and server errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    action.mockResolvedValue({ error: "validation", fieldErrors: { description: "Опишите просьбу: от 20 до 5000 символов.", consent: "Подтвердите согласие на обработку данных." } });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  it("retains text, contact and checkbox state while translating validation messages", async () => {
    await render("ru");
    await fill("country", "საქართველო"); await fill("city", "თბილისი");
    await fill("description", "short"); await fill("external_contact", "private fixture");
    await fill("contact_window", "вечером"); await fill("category", "FAMILY");
    await act(async () => (input("can_call") as HTMLInputElement).click());
    expect(input("external_contact").value).toBe("private fixture");
    await render("ka");
    expect(input("country").value).toBe("საქართველო");
    expect(input("city").value).toBe("თბილისი");
    expect(input("category").value).toBe("FAMILY");
    expect((input("can_call") as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('a[href="/consent/request?country=ge"]')).not.toBeNull();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("შეამოწმეთ მონიშნული ველები");
    expect(input("description").value).toBe("short");
    expect(input("external_contact").value).toBe("private fixture");
    expect(input("contact_window").value).toBe("вечером");
    expect(input("description").getAttribute("aria-invalid")).toBe("true");
    await render("ru");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Проверьте отмеченные поля");
    expect(input("external_contact").value).toBe("private fixture");
    expect((input("can_call") as HTMLInputElement).checked).toBe(true);
  });
  it("retains all ten controls immediately after repeated real invalid actions without a locale rerender", async () => {
    const { createRequest } = await vi.importActual<typeof import("../app/help/actions")>("../app/help/actions");
    action.mockImplementation(createRequest);
    await render("ru");
    await fill("country", "საქართველო"); await fill("city", "თბილისი");
    await fill("description", "short"); await fill("external_contact", "synthetic contact");
    await fill("contact_window", "synthetic evening");
    await fill("category", "FAMILY"); await fill("urgency", "SOON");
    await act(async () => {
      (input("can_call") as HTMLInputElement).click();
      (input("can_message") as HTMLInputElement).click();
    });
    const snapshot = () => Array.from(container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("form input[name], form select[name], form textarea[name]"))
      .filter(element => !element.name.startsWith("$ACTION_"))
      .map(element => ({
        name: element.name, type: element.type, value: element.value,
        checked: element instanceof HTMLInputElement && element.type === "checkbox" ? element.checked : undefined,
      }));
    const draft = snapshot();
    expect(draft).toHaveLength(10);
    await render("ka");
    expect(snapshot()).toEqual(draft);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("შეამოწმეთ მონიშნული ველები");
    expect(input("description").getAttribute("aria-invalid")).toBe("true");
    expect(snapshot()).toEqual(draft);
    expect(serverSupabase).not.toHaveBeenCalled();
    await fill("category", "HOUSING"); await fill("urgency", "URGENT");
    await act(async () => {
      (input("can_call") as HTMLInputElement).click();
      (input("can_message") as HTMLInputElement).click();
    });
    const secondDraft = snapshot();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(action).toHaveBeenCalledTimes(2);
    expect(snapshot()).toEqual(secondDraft);
    expect(serverSupabase).not.toHaveBeenCalled();
    await render("ru");
    expect(snapshot()).toEqual(secondDraft);
  });
  it("starts in Georgia only for a fresh Georgian form, without deriving consent from language", async () => {
    await render("ka");
    expect(input("country").value).toBe("საქართველო");
    await fill("country", "Россия");
    expect(container.querySelector('a[href="/consent/request?country=ru"]')).not.toBeNull();
    await render("ru");
    expect(input("country").value).toBe("Россия");
  });
});
