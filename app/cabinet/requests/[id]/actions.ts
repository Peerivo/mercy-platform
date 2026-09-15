"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase/server";
import { caseStatusSchema } from "@/lib/validation";

export type OwnerRequestActionState = {
  ok: boolean;
  message: string;
};

export async function closeOwnRequest(
  _: OwnerRequestActionState,
  formData: FormData
): Promise<OwnerRequestActionState> {
  const parsed = caseStatusSchema.safeParse({
    caseId: formData.get("caseId"),
    // Статус задаётся только на сервере.
    status: "CLOSED",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Не удалось определить обращение.",
    };
  }

  const s = await serverSupabase();

  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) {
    return {
      ok: false,
      message: "Сессия завершена. Войдите снова.",
    };
  }

  // Не доверяем только can_access_case:
  // координатор тоже имеет доступ к обращению.
  const { data: ownedRequest, error: ownershipError } = await s
    .from("help_requests")
    .select("id,status")
    .eq("id", parsed.data.caseId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (ownershipError || !ownedRequest) {
    return {
      ok: false,
      message: "Вы не можете завершить это обращение.",
    };
  }

  if (ownedRequest.status === "CLOSED") {
    return {
      ok: true,
      message: "Просьба уже завершена.",
    };
  }

  const { error } = await s.rpc("change_case_status", {
    case_id: parsed.data.caseId,
    new_status: "CLOSED",
  });

  if (error) {
    return {
      ok: false,
      message: "Не удалось завершить просьбу. Обновите страницу и повторите.",
    };
  }

  revalidatePath(`/cabinet/requests/${parsed.data.caseId}`);
  revalidatePath("/cabinet");

  return {
    ok: true,
    message: "Спасибо! Просьба отмечена как завершённая.",
  };
}