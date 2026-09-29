import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "@/lib/auth-session";
import { publicConfig } from "@/lib/config";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function browserSupabase() {
  const { url, key } = publicConfig();
  return (client ??= createBrowserClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
  }));
}
