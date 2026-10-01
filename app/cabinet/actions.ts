"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";

export async function requestAccountDeletion() {
  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth?next=%2Fcabinet");

  const { error } = await s.rpc("request_account_deletion");
  if (error) {
    console.error("ACCOUNT DELETION REQUEST:", error.code, error.message);
    redirect("/cabinet?deletion=error");
  }

  revalidatePath("/cabinet");
  redirect("/cabinet?deletion=requested");
}

export async function cancelAccountDeletion() {
  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth?next=%2Fcabinet");

  const { error } = await s.rpc("cancel_account_deletion");
  if (error) {
    console.error("ACCOUNT DELETION CANCEL:", error.code, error.message);
    redirect("/cabinet?deletion=error");
  }

  revalidatePath("/cabinet");
  redirect("/cabinet?deletion=cancelled");
}
