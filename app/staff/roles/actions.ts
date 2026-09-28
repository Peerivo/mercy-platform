"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { mercyRoleChangeSchema } from "@/lib/validation";

export async function changeMercyRole(formData: FormData) {
  const parsed = mercyRoleChangeSchema.safeParse({
    targetUser: formData.get("targetUser"),
    role: formData.get("role"),
    enabled: formData.get("enabled") === "true",
    reason: formData.get("reason"),
    patronKind: formData.get("patronKind") ?? "",
  });

  const email = String(formData.get("email") ?? "").trim();
  const returnTo = email ? `/staff/roles?email=${encodeURIComponent(email)}` : "/staff/roles";
  const withStatus = (status: string) =>
    `${returnTo}${returnTo.includes("?") ? "&" : "?"}${status}`;

  if (!parsed.success) redirect(withStatus("error=validation"));

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) redirect("/auth");

  const { error } = await s.rpc("manage_mercy_role", {
    target_user: parsed.data.targetUser,
    target_role: parsed.data.role,
    enabled: parsed.data.enabled,
    reason_text: parsed.data.reason,
    patron_type:
      parsed.data.role === "PATRON" && parsed.data.enabled
        ? parsed.data.patronKind || null
        : null,
  });

  if (error) redirect(withStatus("error=role"));
  redirect(withStatus("saved=1"));
}
