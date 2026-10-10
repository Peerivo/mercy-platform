import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "../components/language-switcher";
import { LocaleProvider } from "../components/locale-provider";
import { HelpForm } from "../app/help/help-form";
import { LOCALE_COOKIE, parseLocale, type Locale } from "../lib/i18n";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
const createRequest = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../app/help/actions", () => ({ createRequest }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function tree(locale: Locale, withForm = false) {
  return <LocaleProvider locale={locale}><LanguageSwitcher />{withForm && <HelpForm />}</LocaleProvider>;
}

async function render(locale: Locale = "ru", withForm = false) {
  await act(async () => root.render(tree(locale, withForm)));
}

function selector() {
  return container.querySelector<HTMLSelectElement>("select.language-switcher")!;
}

function change(value: string) {
  selector().value = value;
  selector().dispatchEvent(new Event("change", { bubbles: true }));
}

function cookieLocale() {
  return parseLocale(document.cookie.split("; ").find(value => value.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1]);
}

describe("native language dropdown", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults to Russian with a named native select and two readable language options", async () => {
    await act(async () => root.render(<LanguageSwitcher />));
    expect(selector()).not.toBeNull();
    expect(selector().getAttribute("aria-label")).toBe("Язык");
    expect(selector().getAttribute("lang")).toBe("ru");
    expect(selector().value).toBe("ru");
    expect(selector().selectedOptions[0].textContent).toBe("Русский");
    expect(Array.from(selector().options).map(option => [option.value, option.textContent, option.lang])).toEqual([
      ["ru", "Русский", "ru"], ["ka", "ქართული", "ka"],
    ]);
    expect(selector().disabled).toBe(false);
    expect(selector().getAttribute("aria-busy")).toBe("false");
    selector().focus();
    expect(document.activeElement).toBe(selector());
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the current Georgian label and follows provider changes in both directions", async () => {
    await render("ka");
    expect(selector().value).toBe("ka");
    expect(selector().selectedOptions[0].textContent).toBe("ქართული");
    expect(selector().getAttribute("aria-label")).toBe("ენა");
    expect(selector().lang).toBe("ka");
    await render("ru");
    expect(selector().selectedOptions[0].textContent).toBe("Русский");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each(["ru", "ka"] as const)("renders a font-independent decorative %s flag beside the native select", async locale => {
    await render(locale);
    const flag = container.querySelector<SVGSVGElement>("svg.language-flag");
    expect(flag).not.toBeNull();
    expect(flag!.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(flag!.getAttribute("data-locale")).toBe(locale);
    expect(flag!.getAttribute("viewBox")).toBe("0 0 36 24");
    expect(flag!.getAttribute("width")).toBe("24");
    expect(flag!.getAttribute("height")).toBe("16");
    expect(flag!.getAttribute("aria-hidden")).toBe("true");
    expect(flag!.getAttribute("focusable")).toBe("false");
    expect(flag!.parentElement).toBe(selector().parentElement);
    expect(flag!.querySelector("text, image, use, foreignObject, [href], [filter]")).toBeNull();
    expect(container.textContent).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    expect(flag!.querySelector('rect[fill="#fff"][width="36"][height="24"]')).not.toBeNull();
    if (locale === "ru") {
      expect(flag!.querySelectorAll("rect")).toHaveLength(3);
      expect(flag!.querySelector('rect[y="8"][width="36"][height="8"][fill="#0039a6"]')).not.toBeNull();
      expect(flag!.querySelector('rect[y="16"][width="36"][height="8"][fill="#d52b1e"]')).not.toBeNull();
      expect(flag!.querySelector("path")).toBeNull();
    } else {
      expect(flag!.querySelectorAll('g[fill="#e8112d"] path')).toHaveLength(5);
      expect(flag!.querySelector("path")!.getAttribute("d")).toBe("M16 0h4v10h16v4H20v10h-4V14H0v-4h16z");
      expect(Array.from(flag!.querySelectorAll("path[transform]")).map(path => path.getAttribute("transform"))).toEqual([
        "translate(8 5)", "translate(28 5)", "translate(8 19)", "translate(28 19)",
      ]);
    }
    selector().focus();
    expect(document.activeElement).toBe(selector());
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each(["http:", "https:"])("persists only the selected locale with correct cookie attributes on %s", async protocol => {
    vi.stubGlobal("location", { protocol });
    const cookie = vi.spyOn(document, "cookie", "set");
    await render("ru");
    await act(async () => change("ka"));
    expect(cookie).toHaveBeenLastCalledWith(`mercy_locale=ka; Path=/; Max-Age=31536000; SameSite=Lax${protocol === "https:" ? "; Secure" : ""}`);
    expect(router.refresh).toHaveBeenCalledOnce();
    await render("ka");
    await act(async () => change("ru"));
    expect(cookie).toHaveBeenLastCalledWith(`mercy_locale=ru; Path=/; Max-Age=31536000; SameSite=Lax${protocol === "https:" ? "; Secure" : ""}`);
    expect(cookie).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(["ru", "ka"] as const)("ignores repeated %s selection and injected unsupported options", async locale => {
    const cookie = vi.spyOn(document, "cookie", "set");
    await render(locale);
    await act(async () => change(locale));
    for (const invalid of ["", "en", "KA", "ka; Path=/", "__proto__"]) {
      const option = document.createElement("option");
      option.value = invalid;
      selector().append(option);
      await act(async () => change(invalid));
      option.remove();
      expect(selector().value).toBe(locale);
    }
    expect(cookie).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("retains focus but rejects further changes while a refresh is pending", async () => {
    let finish!: () => void;
    router.refresh.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const cookie = vi.spyOn(document, "cookie", "set");
    await render("ru");
    selector().focus();
    act(() => change("ka"));
    expect(selector().disabled).toBe(false);
    expect(selector().getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(selector());
    expect(selector().getAttribute("aria-busy")).toBe("true");
    act(() => change("ka"));
    expect(cookie).toHaveBeenCalledOnce();
    expect(router.refresh).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(selector().getAttribute("aria-disabled")).toBe("false");
    expect(selector().getAttribute("aria-busy")).toBe("false");
    expect(document.activeElement).toBe(selector());
  });

  it("preserves all help controls through real selection handlers and mocked server-tree refreshes", async () => {
    const cookie = vi.spyOn(document, "cookie", "set");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const pushState = vi.spyOn(history, "pushState");
    const replaceState = vi.spyOn(history, "replaceState");
    router.refresh.mockImplementation(() => root.render(tree(cookieLocale(), true)));
    await render("ru", true);
    const form = container.querySelector("form")!;
    const values = {
      country: "Россия", city: "Synthetic city", category: "FAMILY", urgency: "SOON",
      description: "Synthetic draft that must remain unchanged", external_contact: "Synthetic contact", contact_window: "Synthetic evening",
    };
    for (const [name, value] of Object.entries(values)) {
      const element = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      });
    }
    await act(async () => {
      for (const name of ["can_call", "can_message", "consent"]) form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.click();
    });
    const snapshot = () => Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]"))
      .filter(element => !element.name.startsWith("$ACTION_"))
      .map(element => ({ name: element.name, value: element.value, checked: element instanceof HTMLInputElement && element.type === "checkbox" ? element.checked : undefined }));
    const draft = snapshot();
    expect(draft).toHaveLength(10);
    for (const locale of ["ka", "ru"] as const) {
      await act(async () => change(locale));
      expect(selector().value).toBe(locale);
      expect(container.querySelector("svg.language-flag")!.getAttribute("data-locale")).toBe(locale);
      expect(container.querySelector("form")).toBe(form);
      expect(snapshot()).toEqual(draft);
      expect(form.querySelector('a[href="/consent/request?country=ru"]')).not.toBeNull();
    }
    expect(cookie.mock.calls.map(([value]) => value.split(";")[0])).toEqual(["mercy_locale=ka", "mercy_locale=ru"]);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(storage).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });
});
