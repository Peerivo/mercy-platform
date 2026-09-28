import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AUTH_COOKIE_OPTIONS } from "@/lib/auth-session";
import { publicConfig } from "@/lib/config";

export async function serverSupabase() {
  const jar = await cookies();
  const { url, key } = publicConfig();

  return createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => jar.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server Component; proxy refreshes cookies. */
        }
      },
    },
  });
}
