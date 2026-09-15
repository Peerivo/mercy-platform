import { redirect } from "next/navigation";

export default function SafePage() {
  redirect("/auth");
}