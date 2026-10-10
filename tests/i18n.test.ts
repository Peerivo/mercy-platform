import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { dateLocale, enumLabel, normalizeMessage, parseLocale, translate } from "../lib/i18n";
import { georgian } from "../lib/i18n/ka";
import { getRequestConsentVersion } from "../lib/request-consent";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

describe("explicit Georgian locale", () => {
  it("accepts only an exact supported locale cookie", () => {
    expect(parseLocale("ka")).toBe("ka");
    for (const invalid of [null, undefined, "", "ge", "KA", " ka", "__proto__", "ka; path=/"]) expect(parseLocale(invalid)).toBe("ru");
  });
  it("localizes interface text and leaves unknown content alone", () => {
    expect(translate("ka", "Нужна помощь")).toBe("დახმარება მჭირდება");
    expect(translate("ru", "Нужна помощь")).toBe("Нужна помощь");
    expect(translate("ka", "Unknown text")).toBe("Unknown text");
    expect(translate("ka", "__proto__")).toBe("__proto__");
    expect(enumLabel(() => { throw new Error("must not translate unknown data"); }, "user-written text")).toBe("user-written text");
    expect(enumLabel(message => translate("ka", message), "FAMILY")).toBe("ოჯახი");
    expect(dateLocale("ka")).toBe("ka-GE");
    expect(getRequestConsentVersion("საქართველო")).toBe("request-ge-v2");
    expect(getRequestConsentVersion("Россия")).toBe("request-ru-v2");
  });
  it("has Georgian copy for every Russian interface literal and server-action message", () => {
    const missing: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("components"), "lib/auth-login-notice.ts", "lib/request-status.ts", "lib/i18n/index.ts"]) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if ((ts.isStringLiteral(node) || ts.isJsxText(node)) && /[А-Яа-яЁё]/.test(node.text)) {
          const key = normalizeMessage(node.text);
          // Server-only operational messages are not interface copy.
          if (file.endsWith("actions.ts") && ts.isPropertyAssignment(node.parent) && node.parent.name.getText(source) !== "message" && !file.includes("help/")) return;
          if (!Object.hasOwn(georgian, key)) missing.push(`${file}: ${key}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
    for (const value of Object.values(georgian)) expect(value).toMatch(/[ა-ჰ]/);
  });
  it("keeps locale preference separate from auth, country and sensitive form data", () => {
    const switcher = readFileSync("components/language-switcher.tsx", "utf8");
    expect(switcher).toContain("router.refresh()");
    expect(switcher).not.toMatch(/localStorage|sessionStorage|location\.reload|location\.replace/);
    const help = readFileSync("app/help/help-form.tsx", "utf8");
    expect(help).toContain("useActionState");
    expect(help).toContain('value: fields[name]');
    expect(help).toContain('checked: choices[name]');
    expect(help).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("localized staff control values", () => {
  it("keeps canonical enum values and user names out of the translator", () => {
    const forms = readFileSync("app/staff/cases/action-forms.tsx", "utf8");
    expect(forms).toContain('<option key={x} value={x}>{enumLabel(t,x)}</option>');
    expect(forms).toContain('{c.display_name}');
    expect(forms).not.toContain('t(c.display_name)');
    expect(forms).toContain('{t(state.message)}');
    const reports = readFileSync("app/staff/reports/page.tsx", "utf8");
    expect(reports).toContain('value="RESOLVED"');
    expect(reports).toContain('value="DISMISSED"');
  });
});
