import { redirect } from "next/navigation";

export default function Safe() {
  redirect("/auth");
}
