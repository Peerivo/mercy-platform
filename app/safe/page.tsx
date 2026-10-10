
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Безопасный выход — Язык милосердия"),
  robots: { index: false, follow: false },
};
}

export default function SafePage() {
  redirect("/auth");
}