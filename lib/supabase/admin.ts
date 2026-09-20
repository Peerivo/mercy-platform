import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicConfig } from "@/lib/config";

let adminClient: SupabaseClient | null = null;

export function adminSupabase() {
  if (adminClient) return adminClient;

  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is required for server-side moderation."
    );
  }

  const { url } = publicConfig();

  adminClient = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}
