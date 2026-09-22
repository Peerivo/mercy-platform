import { redirect } from "next/navigation";

export const metadata = {
  title: "Безопасный выход — Язык милосердия",
  robots: { index: false, follow: false },
};

export default function SafePage() {
  redirect("/auth");
}