import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicConfig } from "@/lib/config";

const serviceRoleSchema = z.string().min(20);

export function serverSupabaseAdmin() {
  const { url } = publicConfig();
  const key = serviceRoleSchema.safeParse(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.MERCY_SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!key.success) {
    throw new Error(
      "Не настроен server-only Supabase service role key для Mercy Auth bridge. " +
        "Значение должно приходить из canonical Peerivo secrets store.",
    );
  }

  return createClient(url, key.data, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
